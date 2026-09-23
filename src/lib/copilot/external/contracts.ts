import { z } from "zod";
import type { Block } from "../blocks";

export const OutputFormatSchema = z.enum(["json", "markdown", "telegram-markdownv2", "plain-text"]);
export type OutputFormat = z.infer<typeof OutputFormatSchema>;
export const MessageInputSchema = z.object({
  message: z.string().trim().min(1).max(8000),
  contextId: z.string().uuid().optional(),
  taskId: z.string().min(1).max(100).optional(),
  format: OutputFormatSchema.default("json"),
  reasoning: z.boolean().default(false),
}).strict();
export type MessageInput = z.infer<typeof MessageInputSchema>;
export type Channel = "api" | "a2a" | "telegram";
export type IntegrationScope = "copilot:read" | "copilot:propose" | "copilot:approve";
export type TaskState = "queued" | "working" | "completed" | "input-required" | "auth-required" | "failed" | "canceled" | "rejected";

export interface IdentityRef {
  kind: "client" | "telegram";
  clientId: string;
  userId?: string;
  subject?: string;
  channel: Channel;
}

export interface IntegrationDocument {
  id: string;
  partitionKey: string;
  kind: string;
  createdAt: string;
  updatedAt: string;
  ttl?: number;
  _etag?: string;
}

export interface PendingAction {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  label: string;
  expiresAt: string;
  state: "pending" | "executing" | "succeeded" | "failed" | "indeterminate" | "rejected";
  startedAt?: string;
  result?: unknown;
  error?: string;
}

export interface Artifact {
  id: string;
  name: string;
  mediaType: "text/csv" | "application/json";
  text: string;
}

export interface RenderedMessage {
  text: string;
  parseMode?: "MarkdownV2";
}

export interface ExternalResult {
  format: OutputFormat;
  messages: RenderedMessage[];
  blocks: Block[];
  artifacts: Artifact[];
  warnings: string[];
}

export interface CopilotTask extends IntegrationDocument {
  kind: "task";
  identity: IdentityRef;
  contextId: string;
  requestHash: string;
  requests: Record<string, string>;
  accessFingerprint: string;
  input: MessageInput;
  state: TaskState;
  attempts: number;
  leaseUntil?: string;
  leaseOwner?: string;
  result?: ExternalResult;
  actions: PendingAction[];
  tools: { tool: string; ok: boolean }[];
  deliveryPublished?: boolean;
  error?: { code: string; message: string };
  delivery?: { chatId: string; replyTo?: number };
}

export class IntegrationError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "IntegrationError";
  }
}

export const terminalTask = (state: TaskState): boolean => ["completed", "failed", "canceled", "rejected"].includes(state);