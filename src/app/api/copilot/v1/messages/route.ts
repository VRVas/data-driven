import { externalPermission } from "@/lib/copilot/external/auth";
import { integrationFailure, integrationResponse, readBody } from "@/lib/copilot/external/http";
import { submitTask, taskView } from "@/lib/copilot/external/tasks";
import { startCopilotWorker } from "@/lib/copilot/external/worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const caller = await externalPermission("copilot:use", request, "api");
    const task = await submitTask(caller, await readBody(request), request.headers.get("idempotency-key") ?? "");
    startCopilotWorker();
    return integrationResponse(taskView(task), 202, { location: `/api/copilot/v1/tasks/${task.id}`, "retry-after": "1" });
  } catch (error) { return integrationFailure(error); }
}