"use server";

import { requireUser } from "@/lib/auth/guards";
import { getCopilotProvider } from "@/lib/copilot/provider";
import { logAudit } from "@/lib/store/audit";

export interface CopilotReply {
  reply: string;
  provider: string;
  tools: { tool: string; ok: boolean }[];
  error?: string;
}

/** Ask the copilot a question. Acts as the signed-in user; every turn is audited. */
export async function askCopilot(message: string): Promise<CopilotReply> {
  const user = await requireUser();
  const text = (message ?? "").trim();
  if (!text) return { reply: "Ask me something about the pipeline.", provider: "n/a", tools: [] };
  if (text.length > 1000) return { reply: "That's a bit long — try a shorter question.", provider: "n/a", tools: [] };

  try {
    const turn = await getCopilotProvider().ask(text, user);
    await logAudit({
      actorId: user.id,
      actorName: user.name,
      action: "copilot.query",
      entity: "copilot",
      entityId: "-",
      summary: `Asked copilot: ${text.slice(0, 80)}`,
    });
    return {
      reply: turn.reply,
      provider: turn.provider,
      tools: turn.toolRuns.map((r) => ({ tool: r.tool, ok: r.ok })),
    };
  } catch (e) {
    return {
      reply: "Something went wrong answering that. Please try again.",
      provider: "error",
      tools: [],
      error: e instanceof Error ? e.message : "error",
    };
  }
}
