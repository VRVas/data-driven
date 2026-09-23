import { integrationBaseUrl } from "./tasks";
import { OutputFormatSchema } from "./contracts";

export function integrationOpenApi() {
  const string = { type: "string" };
  const timestamp = { type: "string", format: "date-time" };
  const artifact = {
    type: "object", required: ["id", "name", "mediaType", "text"],
    properties: { id: string, name: string, mediaType: { enum: ["text/csv", "application/json"] }, text: string },
  };
  const action = {
    type: "object", required: ["id", "tool", "args", "label", "state", "expiresAt"],
    properties: {
      id: { type: "string", format: "uuid" }, tool: string, args: { type: "object" }, label: string, expiresAt: timestamp, startedAt: timestamp,
      state: { enum: ["pending", "executing", "succeeded", "failed", "indeterminate", "rejected"] }, result: {}, error: string,
    },
  };
  const result = {
    type: "object", required: ["format", "messages", "blocks", "artifacts", "warnings"],
    properties: {
      format: { type: "string", enum: OutputFormatSchema.options },
      messages: { type: "array", items: { type: "object", required: ["text"], properties: { text: string, parseMode: { const: "MarkdownV2" } } } },
      blocks: { type: "array", items: { type: "object" } },
      artifacts: { type: "array", items: artifact },
      warnings: { type: "array", items: string },
    },
  };
  const error = { description: "Request rejected. The error body contains a stable code, safe message, and requestId.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
  const task = { description: "Caller-owned task snapshot.", content: { "application/json": { schema: { $ref: "#/components/schemas/Task" } } } };
  const id = { name: "id", in: "path", required: true, schema: { type: "string" } };
  const responses = { "200": task, "400": error, "401": error, "403": error, "404": error, "409": error, "413": error, "415": error, "429": error, "500": error, "503": error };
  return {
    openapi: "3.1.0", info: { title: "OOVIE Copilot External API", version: "1.0.0", description: "Authenticated durable copilot tasks. The browser SSE endpoint and legacy per-tool API are separate contracts." },
    servers: [{ url: integrationBaseUrl() }], security: [{ bearer: [] }],
    paths: {
      "/api/copilot/v1/messages": { post: { operationId: "submitCopilotMessage", summary: "Create a task or continue an interrupted task", parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", maxLength: 128, pattern: "^[A-Za-z0-9._:-]+$" } }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/MessageInput" } } } }, responses: { ...responses, "202": { ...task, description: "Persisted for processing. Poll Location, or subscribe to the task events endpoint." } } } },
      "/api/copilot/v1/tasks": { get: { operationId: "listCopilotTasks", parameters: [{ name: "offset", in: "query", schema: { type: "integer", minimum: 0, maximum: 1000 } }], responses: { ...responses, "200": { description: "Up to fifty accessible tasks, newest first, and nextOffset. At most the newest one thousand tasks are listed.", content: { "application/json": { schema: { $ref: "#/components/schemas/TaskList" } } } } } } },
      "/api/copilot/v1/tasks/{id}": { get: { operationId: "getCopilotTask", parameters: [id], responses } },
      "/api/copilot/v1/tasks/{id}/events": { get: { operationId: "watchCopilotTask", parameters: [id], responses: { ...responses, "200": { description: "SSE events named task or error. Reconnect by task ID; disconnection does not cancel work.", content: { "text/event-stream": { schema: { type: "string" } } } } } } },
      "/api/copilot/v1/tasks/{id}/cancel": { post: { operationId: "cancelCopilotTask", parameters: [id], responses } },
      "/api/copilot/v1/tasks/{id}/actions/{actionId}": { post: { operationId: "decideCopilotAction", parameters: [id, { name: "actionId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["decision"], properties: { decision: { type: "string", enum: ["approve", "reject"] } } } } } }, responses: { ...responses, "410": error } } },
      "/api/copilot/v1/tasks/{id}/artifacts/{artifactId}": { get: { operationId: "downloadCopilotArtifact", parameters: [id, { name: "artifactId", in: "path", required: true, schema: { type: "string" } }], responses: { ...responses, "200": { description: "Authenticated CSV or JSON artifact with attachment disposition.", content: { "text/csv": { schema: { type: "string" } }, "application/json": { schema: {} } } } } } },
      "/api/copilot/v1/capabilities": { get: { operationId: "getCopilotCapabilities", responses: { "200": { description: "Current caller scopes, tool permissions, formats, and limits." }, "401": error } } },
      "/api/copilot/v1/openapi": { get: { operationId: "getCopilotOpenApi", responses: { "200": { description: "This authenticated OpenAPI 3.1 document.", content: { "application/json": { schema: { type: "object" } } } }, "401": error, "503": error } } },
    },
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "Entra v2 access token or registered copilot.ext client token. Never a browser cookie or model API key." } },
      schemas: {
        MessageInput: { type: "object", additionalProperties: false, required: ["message"], properties: { message: { type: "string", minLength: 1, maxLength: 8000, pattern: "\\S" }, contextId: { type: "string", format: "uuid" }, taskId: { type: "string", minLength: 1, maxLength: 100 },
          reasoning: { type: "boolean", default: false }, format: { type: "string", enum: OutputFormatSchema.options, default: "json" } } },
        TaskList: { type: "object", required: ["tasks", "nextOffset"], properties: { tasks: { type: "array", maxItems: 50, items: { $ref: "#/components/schemas/Task" } }, nextOffset: { type: ["integer", "null"], minimum: 0 } } },
        Task: {
          type: "object", required: ["apiVersion", "id", "contextId", "state", "createdAt", "updatedAt", "actions", "tools"],
          properties: {
            apiVersion: { const: "1" }, id: string, contextId: { type: "string", format: "uuid" },
            state: { type: "string", enum: ["queued", "working", "completed", "input-required", "auth-required", "failed", "canceled", "rejected"] },
            createdAt: timestamp, updatedAt: timestamp, result, actions: { type: "array", items: action },
            tools: { type: "array", items: { type: "object", required: ["tool", "ok"], properties: { tool: string, ok: { type: "boolean" } } } },
            error: { type: "object", properties: { code: string, message: string } },
          },
        },
        Error: {
          type: "object", required: ["error"],
          properties: {
            requestId: string,
            error: { type: "object", required: ["code", "message"], properties: { code: string, message: string, fields: { type: "array", items: string } } },
          },
        },
      },
    },
  };
}