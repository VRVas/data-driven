import { z } from "zod";
import { externalPermission } from "@/lib/copilot/external/auth";
import { integrationFailure, integrationResponse, readBody } from "@/lib/copilot/external/http";
import { consumeQuota, decideAction, taskView } from "@/lib/copilot/external/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string; actionId: string }> }) {
  try {
    const caller = await externalPermission("copilot:tool:write", request, "api");
    await consumeQuota(caller);
    const { decision } = z.object({ decision: z.enum(["approve", "reject"]) }).strict().parse(await readBody(request));
    const { id, actionId } = await context.params;
    return integrationResponse(taskView(await decideAction(caller, id, actionId, decision)));
  } catch (error) { return integrationFailure(error); }
}