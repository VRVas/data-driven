import { externalPermission } from "@/lib/copilot/external/auth";
import { a2aResponse } from "@/lib/copilot/external/a2a";
import { integrationFailure, readBody } from "@/lib/copilot/external/http";
import { consumeQuota } from "@/lib/copilot/external/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const caller = await externalPermission("copilot:use", request, "a2a");
    const body = await readBody(request);
    const method = body && typeof body === "object" && "method" in body ? body.method : undefined;
    if (method !== "SendMessage" && method !== "SendStreamingMessage") await consumeQuota(caller);
    return await a2aResponse(request, caller, body);
  } catch (error) { return integrationFailure(error); }
}