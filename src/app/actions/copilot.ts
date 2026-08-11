"use server";

import { requirePermission } from "@/lib/auth/authorize";
import { getCopilotProvider, type AskOptions } from "@/lib/copilot/provider";
import { runTool } from "@/lib/copilot/dispatch";
import { wantsReasoning } from "@/lib/copilot/stream";
import { logAudit } from "@/lib/store/audit";
import { b, type Block } from "@/lib/copilot/blocks";

export interface CopilotReply {
  blocks: Block[];
  provider: string;
  tools: { tool: string; ok: boolean }[];
  error?: string;
}

/** Ask the copilot. Acts as the signed-in user; every turn is audited. */
export async function askCopilot(message: string, opts: AskOptions = {}): Promise<CopilotReply> {
  const { user } = await requirePermission("copilot:use");
  const text = (message ?? "").trim();
  if (!text) return { blocks: [b.text("Ask me something about the pipeline.")], provider: "n/a", tools: [] };
  if (text.length > 1000)
    return { blocks: [b.callout("That's a bit long — try a shorter question.", "warning")], provider: "n/a", tools: [] };

  const reasoning = opts.reasoning || wantsReasoning(text);
  try {
    const turn = await getCopilotProvider().ask(text, user, { reasoning });
    await logAudit({
      actorId: user.id,
      actorName: user.name,
      action: "copilot.query",
      entity: "copilot",
      entityId: "-",
      summary: `Asked copilot${reasoning ? " (deep)" : ""}: ${text.slice(0, 80)}`,
    });
    return { blocks: turn.blocks, provider: turn.provider, tools: turn.toolRuns.map((r) => ({ tool: r.tool, ok: r.ok })) };
  } catch (e) {
    return {
      blocks: [b.callout("Something went wrong answering that. Please try again.", "danger")],
      provider: "error",
      tools: [],
      error: e instanceof Error ? e.message : "error",
    };
  }
}

export interface ActionResult {
  ok: boolean;
  blocks: Block[];
  error?: string;
}

// Only mutating tools may be triggered from an action button (navigation
// pseudo-tools like open_lead/open_outbox are handled client-side).
const ACTIONABLE = new Set(["draft_outreach", "advance_lead_stage"]);

/** Execute an interactive action block button. Role-gated + audited via the tool layer. */
export async function runCopilotAction(tool: string, args: Record<string, unknown> = {}): Promise<ActionResult> {
  const { user } = await requirePermission("copilot:tool:write");
  if (!ACTIONABLE.has(tool)) return { ok: false, blocks: [b.callout("That action isn't available.", "warning")], error: "not actionable" };

  const run = await runTool(tool, args, user);
  const d = run.data as Record<string, unknown> | undefined;
  if (!run.ok || d?.ok === false) {
    return { ok: false, blocks: [b.callout((run.error ?? (d?.error as string)) ?? "Action failed.", "danger")], error: run.error };
  }
  await logAudit({
    actorId: user.id,
    actorName: user.name,
    action: "copilot.action",
    entity: "copilot",
    entityId: tool,
    summary: `Copilot action: ${tool}`,
  });

  if (tool === "draft_outreach") {
    return { ok: true, blocks: [b.callout(`Drafted “${d?.subject}” to ${d?.to} (${d?.status}).`, "success", "Outreach drafted")] };
  }
  if (tool === "advance_lead_stage") {
    return { ok: true, blocks: [b.callout(`Moved to ${d?.status}.`, "success")] };
  }
  return { ok: true, blocks: [b.callout("Done.", "success")] };
}
