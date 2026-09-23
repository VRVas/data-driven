import "server-only";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { can } from "@/lib/auth/effective";
import { runAsPrincipal } from "@/lib/auth/principal";
import { logAudit } from "@/lib/store/audit";
import { actionKey, runCopilotTurn, validToolArguments } from "../runtime";
import { withExecutionPolicy } from "../execution";
import { runTool } from "../dispatch";
import { getToolByName } from "../tools";
import { toModelHistory } from "../history";
import { renderAnswer } from "./render";
import { digest, resolveIdentity, requireExternalScope, type ExternalCaller } from "./auth";
import { documentBase, integrationStore, type IntegrationStore } from "./store";
import { IntegrationError, MessageInputSchema, terminalTask, type CopilotTask, type IntegrationDocument, type PendingAction } from "./contracts";
import type { Block } from "../blocks";
import { withDataset } from "@/lib/recovery/control";

interface ContextRecord extends IntegrationDocument {
  kind: "context";
  accessFingerprint: string;
  turns: { taskId: string; requestHash: string; message: string; blocks: Block[] }[];
  leaseOwner?: string;
  leaseUntil?: string;
  completion?: Pick<CopilotTask, "id" | "requestHash" | "result" | "actions" | "tools" | "state">;
}

const controllers = new Map<string, AbortController>();
const activeKey = (task: Pick<CopilotTask, "partitionKey" | "id">) => `${task.partitionKey}/${task.id}`;
const LEASE_MS = 180000;
const TURN_MS = 120000;
const fingerprint = (caller: ExternalCaller) => digest(JSON.stringify({ permissions: caller.principal.effective, scopes: caller.scopes, allowedTools: caller.allowedTools }));

function boundedTurns(turns: ContextRecord["turns"]): ContextRecord["turns"] {
  const recent = turns.slice(-12);
  while (recent.length > 1 && Buffer.byteLength(JSON.stringify(recent)) > 750000) recent.shift();
  return recent;
}

async function acquireContext(store: IntegrationStore, owner: string, id: string): Promise<ContextRecord> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const context = await store.get<ContextRecord>(owner, id);
    if (!context) throw new IntegrationError(404, "context_not_found", "Conversation context not found.");
    if (context.leaseUntil && Date.parse(context.leaseUntil) > Date.now()) throw new IntegrationError(409, "context_busy", "Another operation is using this conversation. Retry shortly.");
    const saved = await store.replace({ ...context, leaseOwner: randomUUID(), leaseUntil: new Date(Date.now() + LEASE_MS).toISOString() }, context._etag!);
    if (saved) return saved;
  }
  throw new IntegrationError(409, "context_busy", "The conversation is busy. Retry shortly.");
}
export function integrationBaseUrl(): string {
  const value = process.env.APP_URL ?? "http://localhost:3000";
  const url = new URL(value);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new IntegrationError(503, "configuration_error", "APP_URL must use HTTPS.");
  return url.origin;
}

export async function consumeQuota(caller: ExternalCaller, store = integrationStore()): Promise<void> {
  const id = `quota:${Math.floor(Date.now() / 60000)}`;
  type Counter = IntegrationDocument & { count: number };
  for (let attempt = 0; attempt < 12; attempt++) {
    const current = await store.get<Counter>(caller.owner, id);
    if (!current) {
      if (await store.create({ ...documentBase("quota", caller.owner, id), count: 1, ttl: 120 })) return;
    } else {
      if (current.count >= caller.requestsPerMinute) throw new IntegrationError(429, "rate_limited", "The integration request limit has been reached.");
      if (await store.replace({ ...current, count: current.count + 1 }, current._etag!)) return;
    }
  }
  throw new IntegrationError(429, "rate_limited", "Please retry the request later.");
}

export async function getTask(caller: ExternalCaller, id: string, store = integrationStore()): Promise<CopilotTask> {
  const task = await store.get<CopilotTask>(caller.owner, id);
  if (!task || task.kind !== "task") throw new IntegrationError(404, "task_not_found", "Task not found.");
  if (task.accessFingerprint !== fingerprint(caller)) throw new IntegrationError(403, "grants_changed", "Access grants changed. Start a new conversation.");
  return task;
}

async function changeTask(store: IntegrationStore, owner: string, id: string, mutate: (task: CopilotTask) => CopilotTask): Promise<CopilotTask> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const task = await store.get<CopilotTask>(owner, id);
    if (!task) throw new IntegrationError(404, "task_not_found", "Task not found.");
    const saved = await store.replace(mutate(task), task._etag!);
    if (saved) return saved;
  }
  throw new IntegrationError(409, "task_busy", "The task changed. Read its current state and retry.");
}

export async function submitTask(caller: ExternalCaller, body: unknown, idempotencyKey: string, delivery?: CopilotTask["delivery"], store = integrationStore()): Promise<CopilotTask> {
  requireExternalScope(caller, "copilot:read");
  if (!can(caller.principal.effective, "copilot:use")) throw new IntegrationError(403, "forbidden", "Copilot access is required.");
  const input = MessageInputSchema.parse(body);
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey)) throw new IntegrationError(400, "idempotency_key_required", "Provide a unique Idempotency-Key of at most 128 safe characters.");
  const requestHash = digest(actionKey({ tool: "message", args: input }));
  const requestKey = digest(idempotencyKey);
  const id = input.taskId ?? `tsk-${digest(`${caller.owner}:${idempotencyKey}`).slice(0, 40)}`;
  const previous = await store.get<CopilotTask>(caller.owner, id);
  if (previous) {
    await getTask(caller, id, store);
    if (previous.requests[requestKey]) {
      if (previous.requests[requestKey] !== requestHash) throw new IntegrationError(409, "idempotency_conflict", "This key was already used for a different request.");
      return previous;
    }
    if (!input.taskId) throw new IntegrationError(409, "idempotency_conflict", "This key was already used for another request.");
    if (input.contextId && input.contextId !== previous.contextId) throw new IntegrationError(400, "context_mismatch", "The task belongs to a different context.");
    if (Object.keys(previous.requests).length >= 50) throw new IntegrationError(409, "task_turn_limit", "Start a new task in this context.");
    await consumeQuota(caller, store);
    return changeTask(store, caller.owner, id, (current) => {
      if (current.requests[requestKey]) {
        if (current.requests[requestKey] !== requestHash) throw new IntegrationError(409, "idempotency_conflict", "This key was already used for a different request.");
        return current;
      }
      if (!["input-required", "auth-required"].includes(current.state) || current.actions.some((action) => action.state === "executing")) {
        throw new IntegrationError(409, "task_not_resumable", "Only interrupted tasks can receive a follow-up.");
      }
      return { ...current, input, state: "queued", requestHash, requests: { ...current.requests, [requestKey]: requestHash }, attempts: 0, actions: [], result: undefined, tools: [], error: undefined, deliveryPublished: false };
    });
  }
  if (input.taskId) throw new IntegrationError(404, "task_not_found", "Task not found.");
  await consumeQuota(caller, store);
  const outstanding = await store.scan<CopilotTask>("task", { partitionKey: caller.owner, states: ["queued", "working"], limit: 11 });
  if (outstanding.length >= 10) throw new IntegrationError(429, "queue_full", "This integration already has ten outstanding tasks.");
  const contextId = input.contextId ?? randomUUID();
  const context = await store.get<ContextRecord>(caller.owner, contextId);
  if (input.contextId && !context) throw new IntegrationError(404, "context_not_found", "Conversation context not found.");
  if (context && context.accessFingerprint !== fingerprint(caller)) throw new IntegrationError(403, "grants_changed", "Access grants changed. Start a new conversation.");
  if (!context) await store.create<ContextRecord>({ ...documentBase("context", caller.owner, contextId), kind: "context", accessFingerprint: fingerprint(caller), turns: [] });
  const task: CopilotTask = {
    ...documentBase("task", caller.owner, id), kind: "task", identity: caller.identity, contextId, requestHash,
    requests: { [requestKey]: requestHash }, accessFingerprint: fingerprint(caller), input, state: "queued", attempts: 0,
    actions: [], tools: [], ...(delivery ? { delivery, deliveryPublished: false } : {}),
  };
  const created = await store.create(task);
  if (created) return created;
  const concurrent = await getTask(caller, id, store);
  if (concurrent.requestHash !== requestHash) throw new IntegrationError(409, "idempotency_conflict", "This key was already used for a different request.");
  return concurrent;
}

export async function listTasks(caller: ExternalCaller, store = integrationStore()): Promise<CopilotTask[]> {
  return (await store.scan<CopilotTask>("task", { partitionKey: caller.owner, limit: 1000, newestFirst: true })).filter((task) => task.accessFingerprint === fingerprint(caller));
}

export function taskView(task: CopilotTask) {
  return { apiVersion: "1", id: task.id, contextId: task.contextId, state: task.state, createdAt: task.createdAt, updatedAt: task.updatedAt,
    result: task.result, actions: task.actions, tools: task.tools, error: task.error };
}

function updatedActionResult(task: CopilotTask, actions: PendingAction[]) {
  if (!task.result) return undefined;
  const blocks = task.result.blocks.filter((block) => !(block.type === "callout" && block.text === "Changes are proposed only. Confirm an action to apply it."));
  return renderAnswer(blocks, task.input.format, integrationBaseUrl(), actions, task.result.artifacts.some((artifact) => artifact.mediaType === "text/csv"));
}

async function proposedActions(blocks: Block[], caller: ExternalCaller): Promise<PendingAction[]> {
  if (!caller.scopes.includes("copilot:propose") || !can(caller.principal.effective, "copilot:tool:write")) return [];
  const seen = new Set<string>();
  const actions: PendingAction[] = [];
  for (const block of blocks) {
    if (block.type !== "actions") continue;
    for (const proposed of block.actions) {
      const tool = getToolByName(proposed.tool);
      const args = proposed.args ?? {};
      if (!tool?.write || !tool.permission || !can(caller.principal.effective, tool.permission)
        || (caller.allowedTools && !caller.allowedTools.includes(tool.name)) || !validToolArguments(tool.name, args)) continue;
      const key = actionKey({ tool: tool.name, args });
      if (seen.has(key)) continue;
      seen.add(key);
      actions.push({ id: randomUUID(), tool: tool.name, args, label: proposed.label.slice(0, 200), expiresAt: new Date(Date.now() + 15 * 60000).toISOString(), state: "pending" });
    }
  }
  if (actions.length > 12) throw new IntegrationError(422, "too_many_actions", "Narrow the request to at most twelve changes.");
  return actions;
}

export async function processTask(owner: string, id: string, store = integrationStore()): Promise<void> {
  const original = await store.get<CopilotTask>(owner, id);
  if (!original || !["queued", "working"].includes(original.state) || (original.leaseUntil && Date.parse(original.leaseUntil) > Date.now())) return;
  if (original.attempts >= 3) {
    await store.replace({ ...original, state: "failed", error: { code: "retry_exhausted", message: "The task could not finish after three attempts." } }, original._etag!);
    return;
  }
  const context = await store.get<ContextRecord>(owner, original.contextId);
  if (!context) {
    await store.replace({ ...original, state: "failed", error: { code: "context_expired", message: "The conversation expired. Start a new conversation." } }, original._etag!);
    return;
  }
  if (context.leaseUntil && Date.parse(context.leaseUntil) > Date.now()) return;
  const earlier = await store.scan<CopilotTask>("task", { partitionKey: owner, states: ["queued", "working"], limit: 1000 });
  if (earlier.some((candidate) => candidate.contextId === original.contextId && candidate.id !== original.id
    && (candidate.createdAt < original.createdAt || candidate.createdAt === original.createdAt && candidate.id < original.id))) return;
  const leaseOwner = randomUUID();
  const leaseUntil = new Date(Date.now() + LEASE_MS).toISOString();
  const claimedContext = await store.replace({ ...context, leaseOwner, leaseUntil }, context._etag!);
  if (!claimedContext) return;
  const task = await store.replace<CopilotTask>({ ...original, state: "working", leaseOwner, leaseUntil, attempts: original.attempts + 1 }, original._etag!);
  if (!task) {
    await store.replace({ ...claimedContext, leaseOwner: undefined, leaseUntil: undefined }, claimedContext._etag!);
    return;
  }
  const controller = new AbortController();
  controllers.set(activeKey(task), controller);
  const deadline = setTimeout(() => controller.abort(new Error("Task deadline exceeded")), TURN_MS);
  const monitor = setInterval(() => {
    void store.get<CopilotTask>(owner, id).then((current) => {
      if (!current || current.state === "canceled" || current.leaseOwner !== leaseOwner) controller.abort();
    }).catch(() => controller.abort());
  }, 1000);
  let currentContext = claimedContext;
  try {
    const caller = await resolveIdentity(task.identity);
    if (!can(caller.principal.effective, "copilot:use") || fingerprint(caller) !== task.accessFingerprint || context.accessFingerprint !== task.accessFingerprint) throw new IntegrationError(403, "grants_changed", "The caller's access grants changed.");
    let completion = context.completion?.id === id && context.completion.requestHash === task.requestHash ? context.completion : undefined;
    if (!completion) {
      const history = toModelHistory(context.turns.filter((turn) => turn.taskId !== id || turn.requestHash !== task.requestHash).flatMap((turn) => [
        { role: "user" as const, text: turn.message, at: context.updatedAt },
        { role: "assistant" as const, blocks: turn.blocks, at: context.updatedAt },
      ]), task.input.message);
      const execution = runAsPrincipal(caller.principal, () => withExecutionPolicy({ writes: caller.scopes.includes("copilot:propose") ? "propose" : "deny", allowedTools: caller.allowedTools, signal: controller.signal },
        () => runCopilotTurn(task.input.message, caller.principal.user, { history, reasoning: task.input.reasoning, signal: controller.signal })));
      const turn = await Promise.race([execution, new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }))]);
      controller.signal.throwIfAborted();
      const actions = await proposedActions(turn.blocks, caller);
      const blocks = turn.blocks.filter((block) => block.type !== "reasoning");
      const result = renderAnswer(blocks, task.input.format, integrationBaseUrl(), actions, can(caller.principal.effective, "export:csv"));
      if (Buffer.byteLength(JSON.stringify(result)) > 500000) throw new IntegrationError(422, "result_too_large", "The result is too large. Narrow the request.");
      completion = { id, requestHash: task.requestHash, result, actions, tools: turn.toolRuns.map((tool) => ({ tool: tool.tool, ok: tool.ok })), state: actions.length || turn.needsInput ? "input-required" : "completed" };
      const saved = await store.replace({ ...currentContext, completion, turns: boundedTurns([...context.turns, { taskId: id, requestHash: task.requestHash, message: task.input.message, blocks }]) }, currentContext._etag!);
      if (!saved) throw new Error("Context lease changed");
      currentContext = saved;
    }
    await changeTask(store, owner, id, (current) => current.state === "canceled" || current.leaseOwner !== leaseOwner ? current
      : { ...current, ...completion, leaseOwner: undefined, leaseUntil: undefined });
    await logAudit({ actorId: caller.principal.user.id, actorName: caller.principal.user.name, action: "copilot.query", entity: "copilot", entityId: id, summary: `Copilot ${task.identity.channel} task ${id} (${task.identity.clientId})` });
  } catch (error) {
    await changeTask(store, owner, id, (current) => current.state === "canceled" || current.leaseOwner !== leaseOwner ? current : {
      ...current, state: error instanceof IntegrationError && [401, 403].includes(error.status) ? "rejected" : "failed",
      leaseOwner: undefined, leaseUntil: undefined, error: { code: error instanceof IntegrationError ? error.code : controller.signal.aborted ? "deadline_exceeded" : "execution_failed",
        message: error instanceof IntegrationError ? error.message : "The task could not complete. No unconfirmed write was executed." },
    });
  } finally {
    clearTimeout(deadline); clearInterval(monitor); controllers.delete(activeKey(task));
    await store.replace({ ...currentContext, leaseOwner: undefined, leaseUntil: undefined }, currentContext._etag!);
  }
}

export async function cancelTask(caller: ExternalCaller, id: string, store = integrationStore()): Promise<CopilotTask> {
  await getTask(caller, id, store);
  const task = await changeTask(store, caller.owner, id, (current) => {
    if (current.state === "canceled") return current;
    if (terminalTask(current.state)) throw new IntegrationError(409, "task_not_cancelable", "The task already finished.");
    if (current.actions.some((action) => action.state === "executing")) throw new IntegrationError(409, "action_in_progress", "A confirmed action is already executing and cannot be recalled.");
    return { ...current, state: "canceled", actions: current.actions.map((action) => action.state === "pending" ? { ...action, state: "rejected" } : action) };
  });
  controllers.get(activeKey(task))?.abort();
  return task;
}

export async function decideAction(caller: ExternalCaller, taskId: string, actionId: string, decision: "approve" | "reject", store = integrationStore()): Promise<CopilotTask> {
  return withDataset(() => decideInDataset(caller, taskId, actionId, decision, store));
}

async function decideInDataset(caller: ExternalCaller, taskId: string, actionId: string, decision: "approve" | "reject", store: IntegrationStore): Promise<CopilotTask> {
  requireExternalScope(caller, "copilot:approve");
  await getTask(caller, taskId, store);
  const refreshed = await resolveIdentity(caller.identity);
  requireExternalScope(refreshed, "copilot:approve");
  const task = await getTask(refreshed, taskId, store);
  let lockedContext = await acquireContext(store, caller.owner, task.contextId);
  try {
  const claimed = await changeTask(store, caller.owner, taskId, (task) => {
    if (task.accessFingerprint !== fingerprint(refreshed)) throw new IntegrationError(403, "grants_changed", "Access grants changed.");
    const action = task.actions.find((entry) => entry.id === actionId);
    if (!action) throw new IntegrationError(404, "action_not_found", "Action not found.");
    if (action.state !== "pending") throw new IntegrationError(409, "action_already_decided", "This action was already decided. Read the task for its outcome.");
    if (Date.parse(action.expiresAt) <= Date.now()) throw new IntegrationError(410, "action_expired", "This action expired. Ask for a new proposal.");
    if (task.state !== "input-required") throw new IntegrationError(409, "task_not_actionable", "This task is not awaiting approval.");
    const tool = getToolByName(action.tool);
    if (!tool?.write || !tool.permission || !validToolArguments(action.tool, action.args) || !can(refreshed.principal.effective, tool.permission)
      || !can(refreshed.principal.effective, "copilot:tool:write") || (refreshed.allowedTools && !refreshed.allowedTools.includes(action.tool))) {
      throw new IntegrationError(403, "forbidden", "This action is no longer authorized.");
    }
    const actions = task.actions.map((entry) => entry.id === actionId ? { ...entry, state: decision === "approve" ? "executing" as const : "rejected" as const, startedAt: new Date().toISOString() } : entry);
    return { ...task, actions, result: updatedActionResult(task, actions), state: actions.some((entry) => entry.state === "pending" || entry.state === "executing") ? "input-required" : "completed" };
  });
  const action = claimed.actions.find((entry) => entry.id === actionId)!;
  if (decision === "reject") {
    await logAudit({ actorId: refreshed.principal.user.id, actorName: refreshed.principal.user.name, action: "copilot.action", entity: "copilot", entityId: taskId, summary: `${caller.identity.channel} rejected ${action.tool}` });
    return claimed;
  }
  const outcome = await runAsPrincipal(refreshed.principal, () => withExecutionPolicy({ writes: "execute", allowedTools: refreshed.allowedTools },
    () => runTool(action.tool, action.args, refreshed.principal.user)));
  const domainFailure = outcome.data && typeof outcome.data === "object" && "ok" in outcome.data && outcome.data.ok === false;
  const nextState = outcome.ok && !domainFailure ? "succeeded" as const : outcome.ok ? "failed" as const : "indeterminate" as const;
  const saved = await changeTask(store, caller.owner, taskId, (current) => {
    const actions = current.actions.map((entry) => entry.id === actionId ? { ...entry, state: nextState, result: outcome.data, ...(!outcome.ok ? { error: "The operation failed. Check the record before retrying." } : {}) } : entry);
    return { ...current, actions, result: updatedActionResult(current, actions), state: actions.some((entry) => entry.state === "pending" || entry.state === "executing") ? "input-required" : nextState === "succeeded" ? "completed" : "failed" };
  });
  const resultText = JSON.stringify({ tool: action.tool, state: nextState, result: outcome.data ?? null }).slice(0, 6000);
  const updatedContext = await store.replace({ ...lockedContext, turns: boundedTurns([...lockedContext.turns, { taskId, requestHash: `action:${actionId}`, message: `Confirmed action ${action.label}`, blocks: [{ type: "text" as const, text: resultText }] }]) }, lockedContext._etag!);
  if (updatedContext) lockedContext = updatedContext;
  await logAudit({ actorId: refreshed.principal.user.id, actorName: refreshed.principal.user.name, action: "copilot.action", entity: "copilot", entityId: taskId, summary: `${caller.identity.channel} approved ${action.tool}; ${nextState}` });
  return saved;
  } finally { await store.replace({ ...lockedContext, leaseOwner: undefined, leaseUntil: undefined }, lockedContext._etag!); }
}

export async function* observeTask(caller: ExternalCaller, id: string, signal?: AbortSignal, maximumMs = 150000): AsyncGenerator<CopilotTask> {
  const deadline = Date.now() + maximumMs;
  let etag: string | undefined;
  while (!signal?.aborted && Date.now() < deadline) {
    const freshCaller = await resolveIdentity(caller.identity);
    const task = await getTask(freshCaller, id);
    if (task._etag !== etag) { etag = task._etag; yield task; }
    if (terminalTask(task.state) || ["input-required", "auth-required"].includes(task.state)) return;
    await delay(500, undefined, { signal });
  }
}

export async function recoverUncertainActions(store = integrationStore()): Promise<void> {
  const tasks = await store.scan<CopilotTask>("task", { states: ["input-required"], executingActions: true, limit: 100 });
  for (const task of tasks) {
    if (!task.actions.some((action) => action.state === "executing" && Date.parse(action.startedAt ?? "") + LEASE_MS < Date.now())) continue;
    const actions = task.actions.map((action) => action.state === "executing" && Date.parse(action.startedAt ?? "") + LEASE_MS < Date.now() ? { ...action, state: "indeterminate" as const, error: "Execution was interrupted. Verify the record before proposing another action." } : action);
    await store.replace({ ...task, state: "failed", actions, result: updatedActionResult(task, actions), error: { code: "action_outcome_unknown", message: "A confirmed action was interrupted. Verify the record before attempting another change." } }, task._etag!);
  }
}