"use server";

import { requirePermission } from "@/lib/auth/authorize";
import { getCopilotProvider, type AskOptions } from "@/lib/copilot/provider";
import { runTool } from "@/lib/copilot/dispatch";
import { COPILOT_TOOLS } from "@/lib/copilot/tools";
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
/**
 * Any write tool can back an action button. Derived from the registry rather
 * than listed here, so a new write tool is not silently unclickable — its own
 * permission and record scope are enforced inside runTool either way.
 */
const isActionable = (tool: string) => COPILOT_TOOLS.some((t) => t.name === tool && t.write);

/** Execute an interactive action block button. Permission-gated + audited via the tool layer. */
export async function runCopilotAction(tool: string, args: Record<string, unknown> = {}): Promise<ActionResult> {
  const { user } = await requirePermission("copilot:tool:write");
  if (!isActionable(tool)) return { ok: false, blocks: [b.callout("That action isn't available.", "warning")], error: "not actionable" };

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
  if (tool === "set_next_move") {
    const owed = d?.waitingOn === "us" ? "us" : d?.waitingOn === "them" ? "them" : "nobody";
    return { ok: true, blocks: [b.callout(`Next move on ${d?.name}: ${owed}${d?.followUpDate ? ` by ${d.followUpDate}` : ""}.`, "success")] };
  }
  if (tool === "record_proposal") {
    const confirmed = d?.confirmedBudget as { accepted: number } | null | undefined;
    return {
      ok: true,
      blocks: [
        b.callout(
          `Recorded revision ${d?.revision} for ${d?.name} — €${Number(d?.valueEur ?? 0).toLocaleString()} (${d?.status})${confirmed ? `. Budget confirmed at €${confirmed.accepted.toLocaleString()}.` : ""}`,
          "success",
          "Proposal recorded",
        ),
      ],
    };
  }
  if (tool === "complete_follow_up") {
    return { ok: true, blocks: [b.callout(`Follow-up for ${d?.name} marked done.`, "success")] };
  }
  if (tool === "snooze_follow_up") {
    return { ok: true, blocks: [b.callout(`${d?.name} will come back on ${d?.followUpDate}.`, "success")] };
  }
  if (tool === "set_strategic_value") {
    return { ok: true, blocks: [b.callout(`Strategic value for ${d?.name} set to ${d?.strategicValue}.`, "success")] };
  }
  if (tool === "send_outreach") {
    return {
      ok: true,
      blocks: [
        b.callout(
          `Sent to ${d?.to}${d?.leadName ? ` at ${d.leadName}` : ""}. It cannot be recalled.`,
          "success",
          "Outreach sent",
        ),
      ],
    };
  }
  if (tool === "assign_lead") {
    return {
      ok: true,
      blocks: [
        b.callout(
          `${d?.name} is now owned by ${d?.owner ?? "nobody"}${d?.previousOwner ? ` (was ${d.previousOwner})` : ""}.`,
          "success",
          "Owner changed",
        ),
      ],
    };
  }
  if (tool === "link_deal_to_company") {
    return { ok: true, blocks: [b.callout(`Linked to ${d?.companyName}.`, "success")] };
  }
  return { ok: true, blocks: [b.callout("Done.", "success")] };
}
