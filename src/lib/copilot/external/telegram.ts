import "server-only";
import { timingSafeEqual } from "node:crypto";
import { Api, GrammyError, InputFile } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";
import { z } from "zod";
import { digest, resolveIdentity, telegramPartition, type TelegramLink, type ExternalCaller } from "./auth";
import { IntegrationError, terminalTask, type CopilotTask, type IdentityRef, type IntegrationDocument } from "./contracts";
import { documentBase, integrationStore, type IntegrationStore } from "./store";
import { claimLink } from "./telegram-link";
import { cancelTask, decideAction, getTask, integrationBaseUrl, submitTask } from "./tasks";
import { assertOutboundAllowed, withDataset } from "@/lib/recovery/control";

const PersonSchema = z.object({ id: z.number().int().safe().positive(), is_bot: z.boolean(), first_name: z.string().max(100), last_name: z.string().max(100).optional() });
const ChatSchema = z.object({ id: z.number().int().safe(), type: z.string() });
const MessageSchema = z.object({ message_id: z.number().int(), chat: ChatSchema, from: PersonSchema.optional(), text: z.string().max(8000).optional() });
const UpdateSchema = z.object({ update_id: z.number().int().safe().nonnegative(), message: MessageSchema.optional(),
  callback_query: z.object({ id: z.string().max(256), from: PersonSchema, message: MessageSchema.optional(), data: z.string().max(64).optional() }).optional() });

interface Inbox extends IntegrationDocument {
  kind: "telegram-inbox";
  state: "queued" | "working" | "done" | "failed";
  updateId: number;
  telegramUserId: string;
  name: string;
  chatId: string;
  messageId?: number;
  text?: string;
  callback?: { id: string; data: string };
  leaseUntil?: string;
  attempts: number;
}

interface Session extends IntegrationDocument {
  kind: "telegram-session";
  owner?: string;
  contextId?: string;
  taskId?: string;
  leaseUntil?: string;
}

interface Callback extends IntegrationDocument {
  kind: "telegram-callback";
  identity: IdentityRef;
  taskId: string;
  actionId: string;
  decision: "approve" | "reject";
  expiresAt: string;
}

type Markup = InlineKeyboardMarkup;
interface Outbox extends IntegrationDocument {
  kind: "telegram-outbox";
  state: "queued" | "sending" | "sent" | "failed" | "uncertain";
  chatId: string;
  identity?: IdentityRef;
  taskId?: string;
  text?: string;
  parseMode?: "MarkdownV2";
  document?: { name: string; text: string };
  markup?: Markup;
  messageId?: number;
  attempts: number;
  availableAt?: string;
  leaseUntil?: string;
  errorCode?: string;
}

export type TelegramApi = Pick<Api, "sendMessage" | "sendDocument" | "answerCallbackQuery">;
let api: Api | undefined;
export function telegramApi(): Api {
  if (!api) {
    if (!process.env.TELEGRAM_BOT_TOKEN) throw new IntegrationError(503, "telegram_unavailable", "Telegram is not configured.");
    const testRoot = process.env.TELEGRAM_TEST_API_ROOT;
    if (testRoot) {
      const url = new URL(testRoot);
      if (process.env.NODE_ENV === "production" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.protocol !== "http:") {
        throw new IntegrationError(503, "configuration_error", "The Telegram test gateway is restricted to local development.");
      }
    }
    api = new Api(process.env.TELEGRAM_BOT_TOKEN, testRoot ? { apiRoot: testRoot } : undefined);
  }
  return api;
}

export function verifyTelegramWebhook(request: Request): void {
  if (process.env.COPILOT_EXTERNAL_ENABLED !== "true" || process.env.TELEGRAM_ENABLED !== "true") throw new IntegrationError(503, "telegram_disabled", "Telegram is disabled.");
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  const received = request.headers.get("x-telegram-bot-api-secret-token");
  if (!expected || expected.length < 32 || !received || !timingSafeEqual(Buffer.from(digest(expected), "hex"), Buffer.from(digest(received), "hex"))) {
    throw new IntegrationError(401, "unauthorized", "Invalid webhook credentials.");
  }
}

export async function enqueueTelegram(body: unknown, store = integrationStore()): Promise<boolean> {
  const update = UpdateSchema.parse(body);
  const message = update.callback_query?.message ?? update.message;
  const person = update.callback_query?.from ?? message?.from;
  if (!message || message.chat.type !== "private" || !person || person.is_bot || String(message.chat.id) !== String(person.id)) return false;
  const record: Inbox = { ...documentBase("telegram-inbox", telegramPartition(), `in:${update.update_id}`), kind: "telegram-inbox", state: "queued",
    updateId: update.update_id, telegramUserId: String(person.id), name: [person.first_name, person.last_name].filter(Boolean).join(" "), chatId: String(message.chat.id),
    messageId: message.message_id, text: update.callback_query ? undefined : message.text, attempts: 0,
    ...(update.callback_query ? { callback: { id: update.callback_query.id, data: update.callback_query.data ?? "" } } : {}) };
  return !!(await store.create(record));
}

async function queueMessage(key: string, payload: Omit<Outbox, keyof IntegrationDocument | "kind" | "state" | "attempts">, store: IntegrationStore): Promise<void> {
  await store.create<Outbox>({ ...documentBase("telegram-outbox", telegramPartition(), `out:${key}`), kind: "telegram-outbox", state: "queued", attempts: 0, ...payload });
}

async function telegramCaller(event: Inbox, store: IntegrationStore): Promise<ExternalCaller> {
  const link = await store.get<TelegramLink>(telegramPartition(), `user:${event.telegramUserId}`);
  if (!link) throw new IntegrationError(403, "account_unlinked", `Connect Telegram from ${integrationBaseUrl()}/dashboard/copilot/integrations first.`);
  return resolveIdentity({ kind: "telegram", clientId: telegramPartition(), channel: "telegram", subject: event.telegramUserId, userId: link.userId });
}

export async function processTelegramInbox(event: Inbox, client: TelegramApi, store = integrationStore()): Promise<void> {
  if (event.state === "working" && Date.parse(event.leaseUntil ?? "") > Date.now()) return;
  if (event.attempts >= 3) { await store.replace({ ...event, state: "failed" }, event._etag!); return; }
  const sessionId = `session:${event.telegramUserId}`;
  let session = await store.get<Session>(event.partitionKey, sessionId);
  if (!session) session = await store.create<Session>({ ...documentBase("telegram-session", event.partitionKey, sessionId), kind: "telegram-session" });
  if (!session || (session.leaseUntil && Date.parse(session.leaseUntil) > Date.now())) return;
  let claimedSession = await store.replace({ ...session, leaseUntil: new Date(Date.now() + 180000).toISOString() }, session._etag!);
  if (!claimedSession) return;
  const claimed = await store.replace({ ...event, state: "working", attempts: event.attempts + 1, leaseUntil: new Date(Date.now() + 180000).toISOString() }, event._etag!);
  if (!claimed) { await store.replace({ ...claimedSession, leaseUntil: undefined }, claimedSession._etag!); return; }
  const reply = async (text: string, identity?: IdentityRef) => queueMessage(`update-${event.updateId}`, { chatId: event.chatId, text, identity }, store);
  try {
    if (event.callback) {
      await client.answerCallbackQuery(event.callback.id).catch(() => undefined);
      const caller = await telegramCaller(event, store);
      const match = /^action:([a-f0-9]{40})$/.exec(event.callback.data);
      const callback = match ? await store.get<Callback>(event.partitionKey, `callback:${match[1]}`) : null;
      if (!callback || callback.identity.subject !== caller.identity.subject || callback.identity.userId !== caller.identity.userId || Date.parse(callback.expiresAt) <= Date.now()) {
        throw new IntegrationError(410, "action_expired", "This action is invalid or expired. Ask for a new proposal.");
      }
      const current = await getTask(caller, callback.taskId, store);
      const prior = current.actions.find((action) => action.id === callback.actionId);
      if (prior?.state !== "pending") await reply(`This action is already ${prior?.state ?? "unavailable"}.`, caller.identity);
      else {
        const decided = await decideAction(caller, callback.taskId, callback.actionId, callback.decision, store);
        const action = decided.actions.find((entry) => entry.id === callback.actionId)!;
        await reply(`${action.label}: ${action.state}.${action.error ? ` ${action.error}` : ""}`, caller.identity);
      }
    } else if (/^\/start\s+/.test(event.text ?? "")) {
      await claimLink(event.text!.replace(/^\/start\s+/, "").trim(), event.telegramUserId, event.name, store);
      await reply("Connection requested. Return to the signed-in application and confirm this Telegram account. No CRM access is granted until you confirm there.");
    } else if (/^\/(start|help)(?:\s|$)/.test(event.text ?? "")) {
      await reply(`OOVIE BD Copilot\nConnect your account: ${integrationBaseUrl()}/dashboard/copilot/integrations\n/new starts a separate conversation. /cancel stops the latest task. Text messages and approval buttons are supported.`);
    } else {
      const caller = await telegramCaller(event, store);
      if (claimedSession.owner !== caller.owner) {
        const saved = await store.replace({ ...claimedSession, owner: caller.owner, contextId: undefined, taskId: undefined }, claimedSession._etag!);
        if (!saved) throw new Error("Session changed");
        claimedSession = saved;
      }
      if (!event.text) await reply("This integration currently accepts text only. Open the web copilot for documents, images, or voice.", caller.identity);
      else if (event.text === "/new") {
        const saved = await store.replace({ ...claimedSession, contextId: undefined, taskId: undefined }, claimedSession._etag!);
        if (!saved) throw new Error("Session changed");
        claimedSession = saved;
        await reply("New conversation started.", caller.identity);
      } else if (event.text === "/cancel") {
        if (claimedSession.taskId) await cancelTask(caller, claimedSession.taskId, store);
        await reply(claimedSession.taskId ? "Task canceled. Completed actions cannot be undone." : "There is no current task.", caller.identity);
      } else {
        const task = await submitTask(caller, { message: event.text, format: "telegram-markdownv2", ...(claimedSession.contextId ? { contextId: claimedSession.contextId } : {}) },
          `telegram:${event.updateId}`, { chatId: event.chatId, replyTo: event.messageId }, store);
        const saved = await store.replace({ ...claimedSession, contextId: task.contextId, taskId: task.id }, claimedSession._etag!);
        if (!saved) throw new Error("Session changed");
        claimedSession = saved;
        await reply("Working on your request.", caller.identity);
      }
    }
    await store.replace({ ...claimed, state: "done", leaseUntil: undefined }, claimed._etag!);
  } catch (error) {
    if (error instanceof IntegrationError || error instanceof z.ZodError) {
      await reply(error instanceof IntegrationError ? error.message : "The request was not valid.");
      await store.replace({ ...claimed, state: "done", leaseUntil: undefined }, claimed._etag!);
    } else await store.replace({ ...claimed, state: "queued", leaseUntil: undefined }, claimed._etag!);
  } finally { await store.replace({ ...claimedSession, leaseUntil: undefined }, claimedSession._etag!); }
}

async function queueTaskResult(task: CopilotTask, store: IntegrationStore): Promise<void> {
  if (!task.delivery) return;
  const batch = digest(`${task.id}:${task.requestHash}`).slice(0, 40);
  const markerId = `published:${batch}`;
  if (await store.get(task.partitionKey, markerId)) {
    await store.replace({ ...task, deliveryPublished: true }, task._etag!);
    return;
  }
  const caller = await resolveIdentity(task.identity);
  await getTask(caller, task.id, store);
  const markup: Markup = { inline_keyboard: [] };
  for (const action of task.actions.filter((entry) => entry.state === "pending")) {
    const buttons = [];
    for (const decision of ["approve", "reject"] as const) {
      const token = digest(`${task.partitionKey}:${task.id}:${action.id}:${decision}`).slice(0, 40);
      await store.create<Callback>({ ...documentBase("telegram-callback", telegramPartition(), `callback:${token}`), kind: "telegram-callback", identity: task.identity,
        taskId: task.id, actionId: action.id, decision, expiresAt: action.expiresAt, ttl: 900 });
      buttons.push({ text: `${decision === "approve" ? "Confirm" : "Reject"}: ${action.label}`.slice(0, 64), callback_data: `action:${token}` });
    }
    markup.inline_keyboard.push(buttons);
  }
  const messages = task.result?.messages.length ? task.result.messages : [{ text: task.error?.message ?? `Task ${task.state}.` }];
  for (const [index, message] of messages.entries()) {
    await queueMessage(`task-${batch}-${String(index).padStart(3, "0")}`, { chatId: task.delivery.chatId, identity: task.identity, taskId: task.id, text: message.text,
      parseMode: "parseMode" in message ? message.parseMode : undefined,
      ...(index === messages.length - 1 && markup.inline_keyboard.length ? { markup } : {}) }, store);
  }
  for (const [index, artifact] of (task.result?.artifacts ?? []).entries()) {
    await queueMessage(`task-${batch}-${String(index + messages.length).padStart(3, "0")}`, { chatId: task.delivery.chatId, identity: task.identity, taskId: task.id, document: { name: artifact.name, text: artifact.text } }, store);
  }
  await store.create(documentBase("telegram-published", task.partitionKey, markerId));
  await store.replace({ ...task, deliveryPublished: true }, task._etag!);
}

export async function deliverTelegram(record: Outbox, client: TelegramApi, store = integrationStore()): Promise<void> {
  if (record.state === "sending") {
    if (Date.parse(record.leaseUntil ?? "") <= Date.now()) await store.replace({ ...record, state: "uncertain", errorCode: "delivery_interrupted" }, record._etag!);
    return;
  }
  if (record.availableAt && Date.parse(record.availableAt) > Date.now()) return;
  if (record.identity) {
    try {
      const caller = await resolveIdentity(record.identity);
      if (record.taskId) await getTask(caller, record.taskId, store);
    } catch { await store.replace({ ...record, state: "failed", errorCode: "access_revoked" }, record._etag!); return; }
  }
  const rateId = `send-rate:${record.chatId}`;
  const rate = await store.get<IntegrationDocument & { nextAt: number }>(record.partitionKey, rateId);
  if (rate && rate.nextAt > Date.now()) return;
  const nextRate = { ...documentBase("telegram-rate", record.partitionKey, rateId), nextAt: Date.now() + 1200, ttl: 120 };
  if (!(rate ? await store.replace(nextRate, rate._etag!) : await store.create(nextRate))) return;
  const claimed = await store.replace({ ...record, state: "sending", attempts: record.attempts + 1, leaseUntil: new Date(Date.now() + 60000).toISOString() }, record._etag!);
  if (!claimed) return;
  try {
    let response;
    if (record.document) response = await client.sendDocument(record.chatId, new InputFile(Buffer.from(record.document.text), record.document.name), { protect_content: true });
    else {
      try {
        response = await client.sendMessage(record.chatId, record.text ?? "", { parse_mode: record.parseMode, reply_markup: record.markup, protect_content: true, link_preview_options: { is_disabled: true } });
      } catch (error) {
        if (!(error instanceof GrammyError) || error.error_code !== 400 || !/parse entities/i.test(error.description) || !record.parseMode) throw error;
        response = await client.sendMessage(record.chatId, record.text ?? "", { reply_markup: record.markup, protect_content: true, link_preview_options: { is_disabled: true } });
      }
    }
    await store.replace({ ...claimed, state: "sent", messageId: response.message_id, leaseUntil: undefined }, claimed._etag!);
  } catch (error) {
    if (error instanceof GrammyError && error.error_code === 429 && claimed.attempts < 5) {
      await store.replace({ ...claimed, state: "queued", availableAt: new Date(Date.now() + (error.parameters.retry_after ?? 30) * 1000).toISOString(), leaseUntil: undefined, errorCode: "rate_limited" }, claimed._etag!);
    } else {
      await store.replace({ ...claimed, state: error instanceof GrammyError && error.error_code < 500 ? "failed" : "uncertain", errorCode: error instanceof GrammyError ? `telegram_${error.error_code}` : "network_outcome_unknown" }, claimed._etag!);
    }
  }
}

let timer: ReturnType<typeof setInterval> | undefined;
let busy = false;
export async function sweepTelegram(client: TelegramApi = telegramApi(), store = integrationStore()): Promise<void> {
  return withDataset(async () => { await assertOutboundAllowed(); return sweepInDataset(client, store); });
}

async function sweepInDataset(client: TelegramApi, store: IntegrationStore): Promise<void> {
  const inbox = await store.scan<Inbox>("telegram-inbox", { partitionKey: telegramPartition(), states: ["queued", "working"], limit: 20 });
  for (const event of inbox.slice(0, 4)) await processTelegramInbox(event, client, store);
  const tasks = await store.scan<CopilotTask>("task", { states: ["completed", "input-required", "failed", "rejected", "canceled"], undelivered: true, limit: 100 });
  for (const task of tasks.filter((entry) => entry.identity.channel === "telegram" && entry.delivery)) {
    try { await queueTaskResult(task, store); }
    catch (error) { if (!(error instanceof IntegrationError)) throw error; }
  }
  const outbox = await store.scan<Outbox>("telegram-outbox", { partitionKey: telegramPartition(), states: ["queued", "sending"], limit: 100 });
  const chats = new Set<string>();
  for (const record of outbox) {
    if (chats.has(record.chatId)) continue;
    chats.add(record.chatId);
    await deliverTelegram(record, client, store);
    if (chats.size >= 8) break;
  }
}

export function startTelegramWorker(): void {
  if (timer || process.env.TELEGRAM_ENABLED !== "true" || process.env.COPILOT_EXTERNAL_ENABLED !== "true") return;
  timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void sweepTelegram().catch((error) => console.error("[telegram worker] sweep failed", { name: error instanceof Error ? error.name : "UnknownError" })).finally(() => { busy = false; });
  }, 1500);
  timer.unref();
}