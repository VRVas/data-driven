import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { IntegrationError } from "./contracts";

export async function readBody(request: Request, maximum = 32768): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new IntegrationError(415, "unsupported_media_type", "Use application/json.");
  }
  if (Number(request.headers.get("content-length") ?? 0) > maximum) throw new IntegrationError(413, "payload_too_large", "The request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new IntegrationError(400, "invalid_json", "A JSON request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new IntegrationError(413, "payload_too_large", "The request is too large.");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    throw new IntegrationError(400, "invalid_json", "The request body is not valid JSON.");
  } finally { reader.releaseLock(); }
}

export function integrationResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers } });
}

export function integrationFailure(error: unknown): Response {
  const requestId = randomUUID();
  if (error instanceof IntegrationError) return integrationResponse({ error: { code: error.code, message: error.message }, requestId }, error.status,
    error.status === 401 ? { "www-authenticate": "Bearer" } : error.status === 429 ? { "retry-after": "60" } : {});
  if (error instanceof ZodError) return integrationResponse({ error: { code: "invalid_request", message: "Request validation failed.", fields: error.issues.map((issue) => issue.path.join(".")) }, requestId }, 400);
  console.error("[copilot integration] request failed", { requestId, name: error instanceof Error ? error.name : "UnknownError" });
  return integrationResponse({ error: { code: "internal_error", message: "The integration request could not be completed." }, requestId }, 500);
}