import "server-only";
import { randomBytes } from "node:crypto";
import { digest, telegramPartition, type TelegramLink } from "./auth";
import { IntegrationError, type IntegrationDocument } from "./contracts";
import { documentBase, integrationStore, type IntegrationStore } from "./store";

export interface LinkRequest extends IntegrationDocument {
  kind: "telegram-link-request";
  userId: string;
  tokenHash: string;
  expiresAt: string;
  state: "waiting" | "claimed" | "confirmed";
  candidate?: { id: string; name: string };
}
export interface TelegramSettings extends IntegrationDocument {
  kind: "telegram-settings";
  userId: string;
  telegramUserId?: string;
}

export async function startLink(userId: string, store = integrationStore()): Promise<{ url: string; expiresAt: string }> {
  if (process.env.COPILOT_EXTERNAL_ENABLED !== "true" || process.env.TELEGRAM_ENABLED !== "true") throw new IntegrationError(503, "telegram_disabled", "Telegram is not enabled.");
  const username = process.env.TELEGRAM_BOT_USERNAME;
  if (!username || !/^[A-Za-z0-9_]{5,32}$/.test(username)) throw new IntegrationError(503, "telegram_unavailable", "The bot username is not configured.");
  const partitionKey = telegramPartition();
  const id = `link-request:${userId}`;
  const existing = await store.get<LinkRequest>(partitionKey, id);
  if (existing && Date.now() - Date.parse(existing.updatedAt) < 60000) throw new IntegrationError(429, "link_rate_limit", "Wait one minute before creating another link.");
  const token = randomBytes(24).toString("base64url");
  const tokenHash = digest(token);
  const request: LinkRequest = { ...documentBase("telegram-link-request", partitionKey, id), kind: "telegram-link-request", userId, tokenHash, state: "waiting", expiresAt: new Date(Date.now() + 10 * 60000).toISOString(), ttl: 600 };
  const saved = existing ? await store.replace(request, existing._etag!) : await store.create(request);
  if (!saved) throw new IntegrationError(409, "link_conflict", "A link is already being created. Retry.");
  await store.create({ ...documentBase("telegram-link-token", partitionKey, `link-token:${tokenHash}`), userId, ttl: 600 });
  return { url: `https://t.me/${username}?start=${token}`, expiresAt: request.expiresAt };
}

export async function claimLink(token: string, telegramUserId: string, name: string, store = integrationStore()): Promise<void> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) throw new IntegrationError(400, "link_invalid", "The connection link is invalid or expired.");
  const partition = telegramPartition();
  const hash = digest(token);
  const pointer = await store.get<IntegrationDocument & { userId: string }>(partition, `link-token:${hash}`);
  const request = pointer && await store.get<LinkRequest>(partition, `link-request:${pointer.userId}`);
  if (!request || request.tokenHash !== hash || Date.parse(request.expiresAt) <= Date.now() || request.state === "confirmed") throw new IntegrationError(400, "link_invalid", "The connection link is invalid or expired.");
  if (request.state === "claimed") {
    if (request.candidate?.id === telegramUserId) return;
    throw new IntegrationError(409, "link_claimed", "This link has already been used.");
  }
  const saved = await store.replace({ ...request, state: "claimed", candidate: { id: telegramUserId, name: name.slice(0, 100) } }, request._etag!);
  if (!saved) throw new IntegrationError(409, "link_conflict", "The connection changed. Create a new link.");
}

export async function confirmLink(userId: string, candidateId: string, store = integrationStore()): Promise<void> {
  const partition = telegramPartition();
  const request = await store.get<LinkRequest>(partition, `link-request:${userId}`);
  if (!request || request.state !== "claimed" || request.candidate?.id !== candidateId || Date.parse(request.expiresAt) <= Date.now()) {
    throw new IntegrationError(400, "link_invalid", "The connection request is invalid or expired.");
  }
  const existing = await store.get<TelegramLink>(partition, `user:${candidateId}`);
  const previousSettings = existing ? await store.get<TelegramSettings>(partition, `settings:${existing.userId}`) : null;
  if (existing?.state === "active" && existing.userId !== userId && previousSettings?.telegramUserId === candidateId) throw new IntegrationError(409, "account_already_linked", "That Telegram identity is already linked to another account.");
  if (!(await store.replace({ ...request, state: "confirmed" }, request._etag!))) throw new IntegrationError(409, "link_conflict", "This request was already processed.");
  const link: TelegramLink = { ...documentBase("telegram-link", partition, `user:${candidateId}`), kind: "telegram-link", userId, telegramUserId: candidateId, name: request.candidate.name, state: "active", ttl: -1 };
  const linked = existing ? await store.replace(link, existing._etag!) : await store.create(link);
  if (!linked) throw new IntegrationError(409, "link_conflict", "This Telegram identity was linked concurrently. Start again.");
  await updateSettings(userId, candidateId, store);
}

async function updateSettings(userId: string, telegramUserId: string | undefined, store: IntegrationStore): Promise<void> {
  const partition = telegramPartition();
  const id = `settings:${userId}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const existing = await store.get<TelegramSettings>(partition, id);
    const next: TelegramSettings = { ...documentBase("telegram-settings", partition, id), kind: "telegram-settings", userId, telegramUserId, ttl: -1 };
    if (existing ? await store.replace(next, existing._etag!) : await store.create(next)) return;
  }
  throw new IntegrationError(409, "link_conflict", "The connection settings changed. Retry.");
}

export async function disconnectTelegram(userId: string, store = integrationStore()): Promise<void> {
  await updateSettings(userId, undefined, store);
}

export async function linkStatus(userId: string, store = integrationStore()) {
  if (process.env.TELEGRAM_ENABLED !== "true") return { enabled: false as const, linked: null, pending: null };
  const partition = telegramPartition();
  const settings = await store.get<TelegramSettings>(partition, `settings:${userId}`);
  const linked = settings?.telegramUserId ? await store.get<TelegramLink>(partition, `user:${settings.telegramUserId}`) : null;
  const pending = await store.get<LinkRequest>(partition, `link-request:${userId}`);
  return { enabled: true as const, linked: linked?.state === "active" ? { id: linked.telegramUserId, name: linked.name } : null,
    pending: pending?.state === "claimed" && Date.parse(pending.expiresAt) > Date.now() ? pending.candidate ?? null : null };
}