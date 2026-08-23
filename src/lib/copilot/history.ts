import { blocksToMarkdown } from "./serialize";
import type { StoredMessage } from "./threads";

/**
 * Conversation history, shaped for the model.
 *
 * The chat has stored every turn since threads.ts landed, and the API route
 * has always accepted a conversationId - but only to append to afterwards.
 * Nothing ever read it back into the prompt, so every turn was sent as
 * [system, caller, one message] and the model met each question as its first.
 *
 * That is what "it seems a bit dumb" actually was. Asked to "build the
 * experience for them" it has no idea who "them" is, because nobody told it -
 * and the honest answer to a question with no antecedent is to ask who you
 * mean. The model was behaving correctly on the input it was given.
 *
 * Two budgets, because history is the easiest way to spend a context window on
 * nothing: each turn is capped so one enormous table cannot crowd out ten
 * useful exchanges, and the whole run is capped from the most recent backwards
 * so the turns nearest the question always survive.
 */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface HistoryLimits {
  /** Turns to consider, newest first. */
  maxTurns: number;
  /** Characters kept from any single turn. */
  maxCharsPerTurn: number;
  /** Characters kept across the whole history. */
  maxCharsTotal: number;
}

export const HISTORY_LIMITS: HistoryLimits = {
  maxTurns: 12,
  maxCharsPerTurn: 1500,
  maxCharsTotal: 9000,
};

function clip(text: string, max: number): string {
  const flat = text.replace(/\n{3,}/g, "\n\n").trim();
  if (flat.length <= max) return flat;
  // The ellipsis comes out of the budget, not on top of it.
  if (max <= 3) return flat.slice(0, max);
  return `${flat.slice(0, max - 3).trimEnd()}...`;
}

/** What one stored message says, as plain text the model can read. */
export function turnText(message: StoredMessage): string {
  if (message.text && message.text.trim()) return message.text.trim();
  if (message.blocks?.length) return blocksToMarkdown(message.blocks).trim();
  return "";
}

/**
 * The last exchanges of a conversation, newest-biased, within budget.
 *
 * `current` is the message about to be asked. It is dropped if it is already
 * the final stored turn, because the route persists AFTER answering and a
 * retry would otherwise send the question twice.
 */
export function toModelHistory(
  stored: StoredMessage[],
  current?: string,
  limits: HistoryLimits = HISTORY_LIMITS,
): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const m of stored) {
    const content = turnText(m);
    if (!content) continue;
    turns.push({ role: m.role, content });
  }

  if (current) {
    const last = turns[turns.length - 1];
    if (last?.role === "user" && last.content === current.trim()) turns.pop();
  }

  const recent = turns.slice(-limits.maxTurns);

  // Walk backwards so the turns nearest the question are the ones that survive.
  const kept: ChatTurn[] = [];
  let used = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const content = clip(recent[i].content, limits.maxCharsPerTurn);
    if (used + content.length > limits.maxCharsTotal) break;
    used += content.length;
    kept.unshift({ role: recent[i].role, content });
  }

  // An assistant turn with no question before it reads as an interruption.
  while (kept.length && kept[0].role === "assistant") kept.shift();

  return kept;
}
