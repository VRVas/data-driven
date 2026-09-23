import "server-only";
import type { AskOptions } from "./provider";
import { runCopilotTurn } from "./runtime";
import type { Block } from "./blocks";
import type { SessionUser } from "@/lib/auth/guards";

export type StreamEvent =
  | { type: "block"; block: Block }
  | { type: "tools"; tools: { tool: string; ok: boolean }[] }
  | { type: "done"; provider: string };

/** Auto-route heavy asks to reasoning: why / compare / analyse / recommend / strategy. */
export function wantsReasoning(text: string): boolean {
  return /\b(why|compare|versus|vs\.?|analy[sz]e|recommend|strateg|deep|reason|explain in detail|trade[- ]?off|prioriti[sz]e)\b/i.test(text);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Stream a copilot turn as a sequence of block events. The local provider
 * composes synchronously, so blocks are revealed one-by-one for the progressive
 * UX; the Foundry provider (once configured) yields blocks as its structured
 * output resolves. The transport contract stays identical either way.
 */
export async function* streamTurn(
  message: string,
  user: SessionUser,
  opts: AskOptions = {},
): AsyncGenerator<StreamEvent> {
  const turn = await runCopilotTurn(message, user, opts);
  for (const block of turn.blocks) {
    yield { type: "block", block };
    await sleep(60);
  }
  yield { type: "tools", tools: turn.toolRuns.map((r) => ({ tool: r.tool, ok: r.ok })) };
  yield { type: "done", provider: turn.provider };
}
