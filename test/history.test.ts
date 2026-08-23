import { describe, it, expect } from "vitest";
import { toModelHistory, turnText, HISTORY_LIMITS } from "@/lib/copilot/history";
import type { StoredMessage } from "@/lib/copilot/threads";

const user = (text: string, at = "2026-08-23T10:00:00.000Z"): StoredMessage => ({ role: "user", text, at });
const bot = (text: string, at = "2026-08-23T10:00:01.000Z"): StoredMessage => ({
  role: "assistant",
  blocks: [{ type: "text", text }],
  at,
});

describe("conversation history for the model", () => {
  it("reads an assistant turn out of its blocks", () => {
    expect(turnText(bot("Alibaba ranks 59."))).toContain("Alibaba ranks 59.");
    expect(turnText(user("what about Zara?"))).toBe("what about Zara?");
  });

  it("keeps a turn with nothing in it out of the prompt", () => {
    const empty: StoredMessage = { role: "assistant", blocks: [], text: null, at: "2026-08-23T10:00:00.000Z" };
    expect(turnText(empty)).toBe("");
    expect(toModelHistory([user("hi"), empty])).toHaveLength(1);
  });

  it("carries the exchange in order, oldest first", () => {
    const out = toModelHistory([user("tell me about Alibaba"), bot("Alibaba ranks 59."), user("and Zara?")]);
    expect(out.map((t) => t.role)).toEqual(["user", "assistant", "user"]);
    expect(out[0].content).toBe("tell me about Alibaba");
  });

  it("does not send the question twice", () => {
    // The route persists AFTER answering, so a retry finds its own message
    // already at the end of the thread.
    const out = toModelHistory([user("tell me about Alibaba"), bot("It ranks 59."), user("why?")], "why?");
    expect(out.map((t) => t.content)).toEqual(["tell me about Alibaba", "It ranks 59."]);
  });

  it("clips one enormous turn rather than losing ten useful ones", () => {
    const huge = user("x".repeat(9000));
    const out = toModelHistory([huge, bot("ok"), user("and?")]);
    expect(out[0].content.length).toBeLessThanOrEqual(HISTORY_LIMITS.maxCharsPerTurn);
    expect(out[0].content.endsWith("...")).toBe(true);
    expect(out).toHaveLength(3);
  });

  it("drops the oldest first when the whole run will not fit", () => {
    const many: StoredMessage[] = [];
    for (let i = 0; i < 20; i++) {
      many.push(user(`question ${i} ${"y".repeat(1400)}`));
      many.push(bot(`answer ${i}`));
    }
    const out = toModelHistory(many);
    const total = out.reduce((n, t) => n + t.content.length, 0);
    expect(total).toBeLessThanOrEqual(HISTORY_LIMITS.maxCharsTotal);
    // Whatever survives must be the END of the conversation - the turns
    // nearest the question are the ones that explain it.
    expect(out[out.length - 1].content).toContain("answer 19");
  });

  it("never starts on an assistant turn", () => {
    // An answer with no question before it reads as an interruption, and some
    // providers reject a leading assistant message outright.
    const out = toModelHistory([bot("Alibaba ranks 59."), user("why?")]);
    expect(out[0].role).toBe("user");
  });

  it("returns nothing for a conversation that has not started", () => {
    expect(toModelHistory([])).toEqual([]);
    expect(toModelHistory([user("only this")], "only this")).toEqual([]);
  });

  it("respects a caller's own budget", () => {
    const out = toModelHistory([user("aaaa"), bot("bbbb"), user("cccc")], undefined, {
      maxTurns: 2,
      maxCharsPerTurn: 2,
      maxCharsTotal: 100,
    });
    expect(out).toHaveLength(1);
    expect(out[0].content.length).toBeLessThanOrEqual(2);
  });
});
