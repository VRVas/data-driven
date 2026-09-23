import { externalPermission } from "@/lib/copilot/external/auth";
import { integrationFailure, integrationResponse } from "@/lib/copilot/external/http";
import { cancelTask, consumeQuota, taskView } from "@/lib/copilot/external/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const caller = await externalPermission("copilot:use", request, "api");
    await consumeQuota(caller);
    return integrationResponse(taskView(await cancelTask(caller, (await context.params).id)));
  } catch (error) { return integrationFailure(error); }
}