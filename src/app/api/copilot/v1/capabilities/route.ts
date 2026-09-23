import { externalPermission } from "@/lib/copilot/external/auth";
import { integrationFailure, integrationResponse } from "@/lib/copilot/external/http";
import { can } from "@/lib/auth/effective";
import { COPILOT_TOOLS } from "@/lib/copilot/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const caller = await externalPermission("copilot:use", request, "api");
    return integrationResponse({ apiVersion: "1", a2aProtocol: "1.0", formats: ["json", "markdown", "telegram-markdownv2", "plain-text"],
      limits: { inputCharacters: 8000, queuedTasksPerCaller: 10, resultBytes: 500000, taskRetentionDays: 7, actionExpiryMinutes: 15, telegramMessageCharacters: 3500 },
      scopes: caller.scopes, tools: COPILOT_TOOLS.filter((tool) => !!tool.permission && can(caller.principal.effective, tool.permission)
        && (!caller.allowedTools || caller.allowedTools.includes(tool.name))).map((tool) => ({ name: tool.name, description: tool.description, write: !!tool.write })),
      actionDecisions: { dataPart: { type: "copilot.action-decision", actionId: "<stored action UUID>", decision: "approve | reject" }, permission: "copilot:approve plus current tool permission", argumentsEditable: false },
      unsupported: ["arbitrary file or URL inputs", "A2A push callbacks", "A2A gRPC", "A2A 0.3", "automatic writes", "cross-channel conversation sharing"],
    });
  } catch (error) { return integrationFailure(error); }
}