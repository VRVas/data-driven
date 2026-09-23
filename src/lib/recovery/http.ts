import { RecoveryError } from "./package";

export async function boundedBody(request: Request, limit: number): Promise<Buffer> {
  if (Number(request.headers.get("content-length") ?? 0) > limit) throw new RecoveryError("payload_too_large", "The upload exceeds the allowed size.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RecoveryError("empty_body", "A request body is required.");
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.length;
      if (size > limit) { await reader.cancel(); throw new RecoveryError("payload_too_large", "The upload exceeds the allowed size.", 413); }
      chunks.push(Buffer.from(result.value));
    }
    return Buffer.concat(chunks);
  } finally { reader.releaseLock(); }
}
export async function recoveryJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new RecoveryError("invalid_content_type", "Use application/json.", 415);
  const buffer = await boundedBody(request, 16384);
  try { return JSON.parse(buffer.toString("utf8")); }
  catch { throw new RecoveryError("invalid_json", "The request is not valid JSON."); }
}
export function recoveryResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
export function attachment(data: Buffer, name: string): Response {
  return new Response(new Uint8Array(data), { headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${name}"`,
    "cache-control": "no-store", "x-content-type-options": "nosniff", "content-length": String(data.length) } });
}