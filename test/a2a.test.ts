import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { AgentCard, SendMessageRequest, GetTaskRequest, TaskState } from "@a2a-js/sdk";
import { ClientFactory } from "@a2a-js/sdk/client";
import { agentCard, a2aResponse } from "@/lib/copilot/external/a2a";
import type { ExternalCaller } from "@/lib/copilot/external/auth";
import type { CopilotTask } from "@/lib/copilot/external/contracts";

const mocks = vi.hoisted(() => ({ submit: vi.fn(), get: vi.fn(), list: vi.fn(), resolve: vi.fn(), observe: vi.fn(), quota: vi.fn() }));
vi.mock("@/lib/copilot/external/tasks", async (original) => ({ ...await original<object>(), submitTask: mocks.submit, getTask: mocks.get, listTasks: mocks.list, observeTask: mocks.observe, consumeQuota: mocks.quota }));
vi.mock("@/lib/copilot/external/auth", async (original) => ({ ...await original<object>(), resolveIdentity: mocks.resolve }));
vi.mock("@/lib/copilot/external/worker", () => ({ startCopilotWorker: vi.fn() }));

const caller = { owner: "fixture-owner", identity: { kind: "client", clientId: "fixture", channel: "a2a" }, scopes: ["copilot:read"] } as ExternalCaller;
const task: CopilotTask = {
  id: "fixture-task", kind: "task", partitionKey: caller.owner, identity: caller.identity, contextId: "d2f0cc28-f9af-4b4c-aeba-7e801fd4af3b",
  createdAt: "2026-09-22T00:00:00.000Z", updatedAt: "2026-09-22T00:00:01.000Z", requestHash: "fixture", requests: {}, accessFingerprint: "fixture", attempts: 1,
  input: { message: "Fixture", format: "json", reasoning: false }, state: "completed", actions: [], tools: [],
  result: { format: "json", messages: [{ text: "Fixture answer" }], blocks: [{ type: "text", text: "Fixture answer" }], artifacts: [], warnings: [] },
};
let server: Server;
let base: string;
beforeAll(async () => {
  server = createServer(async (incoming, outgoing) => {
    try {
      if (incoming.method === "GET") {
        outgoing.setHeader("content-type", "application/json");
        outgoing.end(JSON.stringify(AgentCard.toJSON(agentCard())));
        return;
      }
      let raw = "";
      for await (const chunk of incoming) raw += chunk;
      const request = new Request(`${base}${incoming.url}`, { method: "POST", body: raw, headers: { "content-type": "application/json", "a2a-version": String(incoming.headers["a2a-version"] ?? "0.3") } });
      const response = await a2aResponse(request, caller, JSON.parse(raw));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      const reader = response.body?.getReader();
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          outgoing.write(Buffer.from(value));
        }
        reader.releaseLock();
      }
      outgoing.end();
    } catch { outgoing.writeHead(500); outgoing.end(); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  vi.stubEnv("APP_URL", base);
});
afterAll(async () => { vi.unstubAllEnvs(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
beforeEach(() => { vi.clearAllMocks(); mocks.resolve.mockResolvedValue(caller); mocks.submit.mockResolvedValue(task); mocks.get.mockResolvedValue(task); mocks.list.mockResolvedValue([task]); });

describe("A2A over real HTTP with the official independent client", () => {
  it("discovers the card, negotiates 1.0, sends a message and retrieves the task", async () => {
    const client = await new ClientFactory().createFromUrl(base);
    const response = await client.sendMessage(SendMessageRequest.fromJSON({ message: { messageId: "fixture-message", role: "ROLE_USER", parts: [{ text: "Fixture", mediaType: "text/plain" }] } }));
    expect("status" in response && response.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    const loaded = await client.getTask(GetTaskRequest.fromJSON({ id: task.id }));
    expect(loaded.artifacts[0].parts[0].content).toMatchObject({ $case: "data", value: { text: "Fixture answer" } });
    expect(loaded.contextId).toBe(task.contextId);
  });

  it("emits an SDK-readable SSE task response", async () => {
    const client = await new ClientFactory().createFromUrl(base);
    const events = [];
    for await (const event of client.sendMessageStream(SendMessageRequest.fromJSON({ message: { messageId: "fixture-stream", role: "ROLE_USER", parts: [{ text: "Fixture" }] } }))) events.push(event);
    expect(events[0].payload?.$case).toBe("task");
  });

  it("preserves structured artifact parts in a running task stream", async () => {
    mocks.submit.mockResolvedValue({ ...task, state: "queued", result: undefined, _etag: "before" });
    mocks.observe.mockImplementation(async function* () { yield { ...task, _etag: "after" }; });
    const client = await new ClientFactory().createFromUrl(base);
    const events = [];
    for await (const event of client.sendMessageStream(SendMessageRequest.fromJSON({ message: { messageId: "fixture-progress", role: "ROLE_USER", parts: [{ text: "Fixture" }] } }))) events.push(event);
    const artifact = events.find((event) => event.payload?.$case === "artifactUpdate")?.payload;
    expect(artifact?.$case === "artifactUpdate" && artifact.value.artifact?.parts[0].content).toMatchObject({ $case: "data", value: { text: "Fixture answer" } });
  });

  it("returns text-only artifacts when the caller requests plain text", async () => {
    mocks.submit.mockResolvedValue({ ...task, input: { ...task.input, format: "plain-text" } });
    const client = await new ClientFactory().createFromUrl(base);
    const response = await client.sendMessage(SendMessageRequest.fromJSON({ message: { messageId: "fixture-text", role: "ROLE_USER", parts: [{ text: "Fixture" }] }, configuration: { acceptedOutputModes: ["text/plain"] } }));
    expect("artifacts" in response && response.artifacts.every((artifact) => artifact.parts.every((part) => part.mediaType === "text/plain"))).toBe(true);
  });

  it("rejects an older protocol version instead of silently changing semantics", async () => {
    const response = await fetch(`${base}/api/a2a`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "GetTask", params: { id: task.id } }) });
    expect((await response.json()).error.code).toBe(-32009);
  });

  it("charges action decisions to the caller quota without replaying a resolved action", async () => {
    const actionId = "fb6e0ec9-b1b9-4632-bc5c-320af99d616d";
    mocks.get.mockResolvedValue({ ...task, actions: [{ id: actionId, state: "succeeded" }] });
    const client = await new ClientFactory().createFromUrl(base);
    await client.sendMessage(SendMessageRequest.fromJSON({ message: { messageId: "fixture-approval", role: "ROLE_USER", taskId: task.id,
      parts: [{ data: { type: "copilot.action-decision", actionId, decision: "approve" } }] } }));
    expect(mocks.quota).toHaveBeenCalledWith(caller);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("does not accept arbitrary file URLs or unsupported push callbacks", async () => {
    const client = await new ClientFactory().createFromUrl(base);
    await expect(client.sendMessage(SendMessageRequest.fromJSON({ message: { messageId: "fixture-file", role: "ROLE_USER", parts: [{ url: "http://169.254.169.254/metadata", mediaType: "text/plain" }] } }))).rejects.toThrow();
    await expect(client.sendMessage(SendMessageRequest.fromJSON({ message: { messageId: "fixture-push", role: "ROLE_USER", parts: [{ text: "Fixture" }] }, configuration: { taskPushNotificationConfig: { url: "http://127.0.0.1/private" } } }))).rejects.toThrow();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});