import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { LocalIntegrationStore } from "@/lib/copilot/external/store";
import { ownerKey, type ExternalCaller } from "@/lib/copilot/external/auth";
import { submitTask, processTask, getTask, decideAction, cancelTask, recoverUncertainActions } from "@/lib/copilot/external/tasks";
import type { CopilotTurn } from "@/lib/copilot/provider";
import type { CopilotTask } from "@/lib/copilot/external/contracts";

const mocks = vi.hoisted(() => ({ run: vi.fn(), tool: vi.fn(), resolve: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/copilot/runtime", async (original) => ({ ...await original<object>(), runCopilotTurn: mocks.run }));
vi.mock("@/lib/copilot/dispatch", () => ({ runTool: mocks.tool }));
vi.mock("@/lib/copilot/external/auth", async (original) => ({ ...await original<object>(), resolveIdentity: mocks.resolve }));
vi.mock("@/lib/store/audit", () => ({ logAudit: mocks.audit }));

const caller: ExternalCaller = {
  identity: { kind: "client", clientId: "fixture", channel: "api" },
  principal: { user: { id: "fixture", name: "Fixture", email: "", role: "member" }, superuser: false, profileIds: [], teamIds: [],
    effective: { superuser: false, permissions: { "copilot:use": "all", "copilot:tool:write": "all", "lead:update": "all" } } },
  owner: ownerKey({ kind: "client", clientId: "fixture", channel: "api" }),
  scopes: ["copilot:read", "copilot:propose", "copilot:approve"], requestsPerMinute: 100,
};
let directory: string;
let store: LocalIntegrationStore;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "copilot-tasks-"));
  store = new LocalIntegrationStore(path.join(directory, "records.json"));
  mocks.resolve.mockResolvedValue(caller);
  mocks.run.mockResolvedValue({ provider: "fixture", toolRuns: [], blocks: [{ type: "text", text: "Fixture answer" }] } satisfies CopilotTurn);
  mocks.tool.mockResolvedValue({ ok: true, tool: "append_note", data: { ok: true, id: "fixture-note" } });
});
afterEach(async () => { vi.resetAllMocks(); await rm(directory, { recursive: true, force: true }); });

describe("durable task lifecycle", () => {
  it("deduplicates requests and rejects reusing their keys for different input", async () => {
    const first = await submitTask(caller, { message: "Fixture" }, "same-key", undefined, store);
    const second = await submitTask(caller, { message: "Fixture" }, "same-key", undefined, store);
    expect(second.id).toBe(first.id);
    await expect(submitTask(caller, { message: "Different" }, "same-key", undefined, store)).rejects.toMatchObject({ status: 409 });
  });

  it("executes once under worker contention and persists its result", async () => {
    const task = await submitTask(caller, { message: "Fixture" }, "worker-race", undefined, store);
    await Promise.all(Array.from({ length: 6 }, () => processTask(caller.owner, task.id, store)));
    expect(mocks.run).toHaveBeenCalledOnce();
    const saved = await getTask(caller, task.id, store);
    expect(saved.state).toBe("completed");
    expect(saved.result?.messages[0].text).toContain("Fixture answer");
  });

  it("cannot read another caller's task or continue their context", async () => {
    const task = await submitTask(caller, { message: "Fixture" }, "isolation", undefined, store);
    const other = { ...caller, owner: "different-owner" };
    await expect(getTask(other, task.id, store)).rejects.toMatchObject({ status: 404 });
    await expect(submitTask(other, { message: "Fixture", contextId: task.contextId }, "other", undefined, store)).rejects.toMatchObject({ status: 404 });
  });

  it("blocks previous results and history after a permission change", async () => {
    const task = await submitTask(caller, { message: "Fixture" }, "permissions", undefined, store);
    const reduced = { ...caller, scopes: ["copilot:read" as const] };
    await expect(getTask(reduced, task.id, store)).rejects.toMatchObject({ status: 403 });
    await expect(submitTask(reduced, { message: "Fixture", contextId: task.contextId }, "permissions-2", undefined, store)).rejects.toMatchObject({ status: 403 });
  });

  it("proposes writes, then executes a stored action at most once", async () => {
    mocks.run.mockResolvedValue({ provider: "fixture", toolRuns: [], blocks: [{ type: "actions", actions: [{ label: "Add note", tool: "append_note", args: { leadId: "fixture-lead", body: "Fixture" } }] }] } satisfies CopilotTurn);
    const task = await submitTask(caller, { message: "Add note" }, "approval", undefined, store);
    await processTask(caller.owner, task.id, store);
    const pending = await getTask(caller, task.id, store);
    expect(pending.state).toBe("input-required");
    expect(mocks.tool).not.toHaveBeenCalled();
    const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => decideAction(caller, task.id, pending.actions[0].id, "approve", store)));
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(mocks.tool).toHaveBeenCalledOnce();
    expect((await getTask(caller, task.id, store)).actions[0].state).toBe("succeeded");
  });

  it("never executes a canceled queued task", async () => {
    const task = await submitTask(caller, { message: "Fixture" }, "cancel", undefined, store);
    await cancelTask(caller, task.id, store);
    await processTask(caller.owner, task.id, store);
    expect(mocks.run).not.toHaveBeenCalled();
    expect((await getTask(caller, task.id, store)).state).toBe("canceled");
  });

  it("recovers a job abandoned by a previous process after its lease expires", async () => {
    const task = await submitTask(caller, { message: "Fixture" }, "recover", undefined, store);
    await store.replace({ ...task, state: "working", attempts: 1, leaseOwner: "dead-process", leaseUntil: new Date(0).toISOString() }, task._etag!);
    await processTask(caller.owner, task.id, store);
    expect((await getTask(caller, task.id, store)).state).toBe("completed");
    expect(mocks.run).toHaveBeenCalledOnce();
  });

  it("resumes an input-required task without replaying its previous turn", async () => {
    mocks.run.mockResolvedValueOnce({ provider: "fixture", toolRuns: [], needsInput: true, blocks: [{ type: "text", text: "Which lead?" }] } satisfies CopilotTurn);
    const task = await submitTask(caller, { message: "Tell me about it" }, "question", undefined, store);
    await processTask(caller.owner, task.id, store);
    await submitTask(caller, { message: "The fixture lead", taskId: task.id }, "answer", undefined, store);
    await processTask(caller.owner, task.id, store);
    expect((await getTask(caller, task.id, store)).state).toBe("completed");
    expect(mocks.run.mock.calls[1][2].history.some((turn: { content: string }) => turn.content.includes("Which lead?"))).toBe(true);
    await submitTask(caller, { message: "The fixture lead", taskId: task.id }, "answer", undefined, store);
    expect(mocks.run).toHaveBeenCalledTimes(2);
  });

  it("rejects expired approvals and marks interrupted writes uncertain without replay", async () => {
    mocks.run.mockResolvedValue({ provider: "fixture", toolRuns: [], blocks: [{ type: "actions", actions: [{ label: "Add note", tool: "append_note", args: { leadId: "fixture", body: "Fixture" } }] }] } satisfies CopilotTurn);
    const task = await submitTask(caller, { message: "Add note" }, "expire", undefined, store);
    await processTask(caller.owner, task.id, store);
    const pending = await getTask(caller, task.id, store);
    await store.replace({ ...pending, actions: pending.actions.map((action) => ({ ...action, expiresAt: new Date(0).toISOString() })) }, pending._etag!);
    await expect(decideAction(caller, task.id, pending.actions[0].id, "approve", store)).rejects.toMatchObject({ status: 410 });
    const expired = await getTask(caller, task.id, store);
    await store.replace({ ...expired, actions: expired.actions.map((action) => ({ ...action, state: "executing", startedAt: new Date(0).toISOString() })) }, expired._etag!);
    await Promise.all(Array.from({ length: 110 }, (_, index) => store.create({ ...expired, id: `old-pending-${index}`, createdAt: new Date(0).toISOString(), actions: expired.actions.map((action) => ({ ...action, state: "pending" })) })));
    await recoverUncertainActions(store);
    const recovered = await getTask(caller, task.id, store);
    expect(recovered.actions[0].state).toBe("indeterminate");
    expect(recovered.result?.messages[0].text).toContain("Outcome uncertain");
    expect(recovered.error?.code).toBe("action_outcome_unknown");
    expect(mocks.tool).not.toHaveBeenCalled();
  });

  it("reuses a persisted completion after a crash without running the model again", async () => {
    const task = await submitTask(caller, { message: "Fixture" }, "completion", undefined, store);
    await processTask(caller.owner, task.id, store);
    const completed = await getTask(caller, task.id, store);
    await store.replace<CopilotTask>({ ...completed, state: "working", result: undefined, attempts: 1, leaseUntil: new Date(0).toISOString() }, completed._etag!);
    await processTask(caller.owner, task.id, store);
    expect((await getTask(caller, task.id, store)).result?.messages[0].text).toContain("Fixture answer");
    expect(mocks.run).toHaveBeenCalledOnce();
  });
});