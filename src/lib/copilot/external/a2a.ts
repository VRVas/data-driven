import "server-only";
import { AgentCard, Task, StreamResponse, Role, TaskState, type SendMessageRequest, type GetTaskRequest, type CancelTaskRequest, type ListTasksRequest, type SubscribeToTaskRequest } from "@a2a-js/sdk";
import { JsonRpcTransportHandler, ServerCallContext, validateVersion, type A2ARequestHandler } from "@a2a-js/sdk/server";
import { A2AError, ContentTypeNotSupportedError, ExtendedAgentCardNotConfiguredError, PushNotificationNotSupportedError, RequestMalformedError, TaskNotCancelableError, TaskNotFoundError, UnsupportedOperationError } from "@a2a-js/sdk/errors";
import { z } from "zod";
import type { ExternalCaller } from "./auth";
import { digest, resolveIdentity } from "./auth";
import { IntegrationError, terminalTask, type CopilotTask, type OutputFormat } from "./contracts";
import { cancelTask, consumeQuota, decideAction, getTask, integrationBaseUrl, listTasks, observeTask, submitTask } from "./tasks";
import { startCopilotWorker } from "./worker";

const STATES = {
  queued: TaskState.TASK_STATE_SUBMITTED, working: TaskState.TASK_STATE_WORKING, completed: TaskState.TASK_STATE_COMPLETED,
  failed: TaskState.TASK_STATE_FAILED, canceled: TaskState.TASK_STATE_CANCELED, rejected: TaskState.TASK_STATE_REJECTED,
  "input-required": TaskState.TASK_STATE_INPUT_REQUIRED, "auth-required": TaskState.TASK_STATE_AUTH_REQUIRED,
} as const;

export function agentCard(): AgentCard {
  const base = integrationBaseUrl();
  return AgentCard.fromJSON({
    name: "OOVIE BD Copilot", version: "1.0.0",
    description: "Permission-scoped CRM research, pipeline analysis, and explicitly approved record changes.",
    supportedInterfaces: [{ url: `${base}/api/a2a`, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
    provider: { organization: "OOVIE", url: base },
    documentationUrl: `${base}/api/copilot/v1/capabilities`,
    capabilities: { streaming: true, pushNotifications: false, extendedAgentCard: false, extensions: [{
      uri: `${base}/api/copilot/v1/capabilities#action-decisions`, required: false,
      description: "A data part with type copilot.action-decision, actionId, and decision approves or rejects one stored proposed action. Approval requires copilot:approve and current tool permissions.",
    }] },
    securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: "Bearer", description: "Registered integration token or tenant-validated Entra access token." } } },
    securityRequirements: [{ schemes: { bearer: { list: [] } } }],
    defaultInputModes: ["text/plain", "application/json"], defaultOutputModes: ["text/plain", "text/markdown", "application/json"],
    skills: [
      { id: "pipeline", name: "Pipeline analysis", description: "Search accessible leads, summarize pipeline value, and explain scores.", tags: ["crm", "pipeline"], examples: ["Which leads need attention?"] },
      { id: "notes", name: "Lead notes", description: "Read accessible lead notes or propose an attributed addition.", tags: ["crm", "notes"], examples: ["What is the latest on a lead?"] },
      { id: "changes", name: "Proposed changes", description: "Propose record changes. Execution requires an explicit authorized action decision.", tags: ["approval", "crm"], examples: ["Prepare a follow-up reminder."] },
    ],
  });
}

export function toA2ATask(task: CopilotTask): Task {
  const mediaType = task.input.format === "markdown" ? "text/markdown" : "text/plain";
  const text = task.result?.messages.map((message) => message.text).join("\n\n") ?? task.error?.message ?? `Task ${task.state}.`;
  const artifacts = task.result ? task.input.format === "json" ? [
    { artifactId: "structured", name: "Structured result and proposed actions", parts: [{ data: { text, blocks: task.result.blocks, actions: task.actions, warnings: task.result.warnings, artifacts: task.result.artifacts }, mediaType: "application/json" }] },
  ] : [{ artifactId: "answer", name: "Answer", parts: [{ text, mediaType }] }] : [];
  return Task.fromJSON({ id: task.id, contextId: task.contextId, status: { state: STATES[task.state], timestamp: task.updatedAt,
    message: { messageId: `${task.id}:${task.updatedAt}`, role: Role.ROLE_AGENT, taskId: task.id, contextId: task.contextId, parts: [{ text, mediaType }] } },
    artifacts, history: [], metadata: { apiVersion: "1", ...(task.error ? { error: task.error } : {}) } });
}

function protocolError(error: unknown): never {
  if (error instanceof IntegrationError) {
    if (error.status === 404 || error.status === 403) throw new TaskNotFoundError();
    if (error.code === "task_not_cancelable" || error.code === "action_in_progress") throw new TaskNotCancelableError();
    throw new RequestMalformedError({ message: error.message });
  }
  if (error instanceof z.ZodError) throw new RequestMalformedError({ message: "Invalid message or action data." });
  if (error instanceof A2AError) throw error;
  throw new Error("The task could not be processed. Retrieve its current status before retrying.");
}

export class CopilotA2AHandler implements A2ARequestHandler {
  constructor(private readonly caller: ExternalCaller, private readonly signal?: AbortSignal) {}
  async getAgentCard() { return agentCard(); }
  async getAuthenticatedExtendedAgentCard(): Promise<never> { throw new ExtendedAgentCardNotConfiguredError(); }
  async createTaskPushNotificationConfig(): Promise<never> { throw new PushNotificationNotSupportedError(); }
  async getTaskPushNotificationConfig(): Promise<never> { throw new PushNotificationNotSupportedError(); }
  async listTaskPushNotificationConfigs(): Promise<never> { throw new PushNotificationNotSupportedError(); }
  async deleteTaskPushNotificationConfig(): Promise<never> { throw new PushNotificationNotSupportedError(); }

  private async receive(request: SendMessageRequest): Promise<CopilotTask> {
    if (request.tenant) throw new RequestMalformedError({ message: "This interface has no tenant routing parameter." });
    if (request.configuration?.taskPushNotificationConfig) throw new PushNotificationNotSupportedError();
    const message = request.message;
    if (!message?.messageId || message.messageId.length > 256 || message.role !== Role.ROLE_USER || !message.parts.length) throw new RequestMalformedError({ message: "A user message with messageId and content is required." });
    if (message.referenceTaskIds.length) throw new UnsupportedOperationError({ message: "Use contextId for continuity; cross-task references are not supported." });
    const caller = await resolveIdentity(this.caller.identity);
    const decisions = message.parts.filter((part) => part.content?.$case === "data");
    if (decisions.length) {
      await consumeQuota(caller);
      if (message.parts.length !== 1 || !message.taskId) throw new RequestMalformedError({ message: "An action decision must be the only part and must name its taskId." });
      const content = decisions[0].content;
      const decision = z.object({ type: z.literal("copilot.action-decision"), actionId: z.string().uuid(), decision: z.enum(["approve", "reject"]) }).strict().parse(content?.$case === "data" ? content.value : null);
      const task = await getTask(caller, message.taskId);
      if (message.contextId && message.contextId !== task.contextId) throw new RequestMalformedError({ message: "Context does not match the task." });
      const prior = task.actions.find((action) => action.id === decision.actionId);
      if (prior?.state === "succeeded" && decision.decision === "approve" || prior?.state === "rejected" && decision.decision === "reject") return task;
      return decideAction(caller, message.taskId, decision.actionId, decision.decision);
    }
    if (message.parts.some((part) => part.content?.$case !== "text" || (part.mediaType && part.mediaType !== "text/plain"))) throw new ContentTypeNotSupportedError();
    const modes = request.configuration?.acceptedOutputModes ?? [];
    let format: OutputFormat = "json";
    if (modes.length && !modes.includes("application/json")) {
      if (modes.includes("text/markdown")) format = "markdown";
      else if (modes.includes("text/plain")) format = "plain-text";
      else throw new ContentTypeNotSupportedError();
    }
    const task = await submitTask(caller, {
      message: message.parts.map((part) => part.content?.$case === "text" ? part.content.value : "").join("\n"),
      ...(message.contextId ? { contextId: message.contextId } : {}), ...(message.taskId ? { taskId: message.taskId } : {}), format,
    }, digest(message.messageId));
    startCopilotWorker();
    return task;
  }

  async sendMessage(request: SendMessageRequest): Promise<Task> {
    try {
      let task = await this.receive(request);
      if (!request.configuration?.returnImmediately && ["queued", "working"].includes(task.state)) {
        for await (const current of observeTask(this.caller, task.id, this.signal)) task = current;
        if (["queued", "working"].includes(task.state)) throw new Error("Task is still processing; retrieve its status using GetTask.");
      }
      return toA2ATask(task);
    } catch (error) { return protocolError(error); }
  }

  async *sendMessageStream(request: SendMessageRequest): AsyncGenerator<StreamResponse> {
    try {
      const task = await this.receive(request);
      yield* this.watch(task);
    } catch (error) { protocolError(error); }
  }

  private async *watch(task: CopilotTask): AsyncGenerator<StreamResponse> {
    yield { payload: { $case: "task", value: toA2ATask(task) } };
    if (!["queued", "working"].includes(task.state)) return;
    for await (const current of observeTask(this.caller, task.id, this.signal)) {
      if (current._etag === task._etag) continue;
      const translated = toA2ATask(current);
      for (const artifact of translated.artifacts) yield { payload: { $case: "artifactUpdate", value: {
        taskId: task.id, contextId: task.contextId, artifact, append: false, lastChunk: true, metadata: undefined,
      } } };
      yield { payload: { $case: "statusUpdate", value: { taskId: task.id, contextId: task.contextId, status: translated.status, metadata: undefined } } };
    }
  }

  async getTask(request: GetTaskRequest): Promise<Task> {
    try { return toA2ATask(await getTask(await resolveIdentity(this.caller.identity), request.id)); }
    catch (error) { return protocolError(error); }
  }

  async cancelTask(request: CancelTaskRequest): Promise<Task> {
    try { return toA2ATask(await cancelTask(await resolveIdentity(this.caller.identity), request.id)); }
    catch (error) { return protocolError(error); }
  }

  async *resubscribe(request: SubscribeToTaskRequest): AsyncGenerator<StreamResponse> {
    try {
      const task = await getTask(await resolveIdentity(this.caller.identity), request.id);
      if (terminalTask(task.state)) throw new UnsupportedOperationError({ message: "A terminal task cannot be subscribed to. Use GetTask." });
      yield* this.watch(task);
    } catch (error) { protocolError(error); }
  }

  async listTasks(request: ListTasksRequest) {
    try {
      const size = request.pageSize ?? 50;
      if (!Number.isInteger(size) || size < 1 || size > 100) throw new RequestMalformedError({ message: "pageSize must be between 1 and 100." });
      let offset = 0;
      if (request.pageToken) {
        const decoded = JSON.parse(Buffer.from(request.pageToken, "base64url").toString()) as { owner: string; offset: number };
        if (decoded.owner !== this.caller.owner || !Number.isSafeInteger(decoded.offset) || decoded.offset < 0) throw new RequestMalformedError();
        offset = decoded.offset;
      }
      const tasks = (await listTasks(await resolveIdentity(this.caller.identity))).filter((task) =>
        (!request.contextId || task.contextId === request.contextId) && (!request.status || STATES[task.state] === request.status)
        && (!request.statusTimestampAfter || Date.parse(task.updatedAt) >= Date.parse(request.statusTimestampAfter)));
      return { tasks: tasks.slice(offset, offset + size).map((task) => { const result = toA2ATask(task); if (!request.includeArtifacts) result.artifacts = []; return result; }),
        totalSize: tasks.length, pageSize: size, nextPageToken: offset + size < tasks.length ? Buffer.from(JSON.stringify({ owner: this.caller.owner, offset: offset + size })).toString("base64url") : "" };
    } catch (error) { return protocolError(error); }
  }
}

export async function a2aResponse(request: Request, caller: ExternalCaller, body: unknown): Promise<Response> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  const id = typeof record.id === "string" || typeof record.id === "number" ? record.id : null;
  const version = request.headers.get("a2a-version") ?? "0.3";
  try { validateVersion(version, agentCard(), "JSONRPC"); }
  catch (error) { return Response.json({ jsonrpc: "2.0", id, error: JsonRpcTransportHandler.mapToJSONRPCError(error) }, { headers: { "cache-control": "no-store", "A2A-Version": "1.0" } }); }
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, request.signal]);
  const context = new ServerCallContext({ user: { isAuthenticated: true, userName: caller.owner }, requestedVersion: version });
  const response = await new JsonRpcTransportHandler(new CopilotA2AHandler(caller, signal)).handle(record, context);
  if (!(Symbol.asyncIterator in response)) return Response.json(response, { headers: { "cache-control": "no-store", "A2A-Version": "1.0" } });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(output) {
      try { for await (const event of response) { if (signal.aborted) break; output.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } }
      catch (error) { if (!signal.aborted) output.enqueue(encoder.encode(`data: ${JSON.stringify({ jsonrpc: "2.0", id, error: JsonRpcTransportHandler.mapToJSONRPCError(error) })}\n\n`)); }
      finally { if (!controller.signal.aborted) output.close(); }
    }, cancel() { controller.abort(); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "A2A-Version": "1.0", "x-accel-buffering": "no" } });
}