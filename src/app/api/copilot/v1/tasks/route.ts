import { externalPermission } from "@/lib/copilot/external/auth";
import { integrationFailure, integrationResponse } from "@/lib/copilot/external/http";
import { consumeQuota, listTasks, taskView } from "@/lib/copilot/external/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const caller = await externalPermission("copilot:use", request, "api");
    await consumeQuota(caller);
    const url = new URL(request.url);
    const offset = Number(url.searchParams.get("offset") ?? "0");
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000) return integrationResponse({ error: { code: "invalid_offset", message: "Use an offset between 0 and 1000." } }, 400);
    const tasks = await listTasks(caller);
    return integrationResponse({ tasks: tasks.slice(offset, offset + 50).map(taskView), nextOffset: tasks.length > offset + 50 ? offset + 50 : null });
  } catch (error) { return integrationFailure(error); }
}