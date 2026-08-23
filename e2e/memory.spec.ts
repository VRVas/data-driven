import { test, expect } from "./fixtures";
import { STORAGE_STATE } from "./constants";

/**
 * Multi-turn memory, through the real streaming route.
 *
 * The chat has always stored every turn and always accepted a conversationId,
 * and nothing ever read either back into the prompt. So every question arrived
 * as the model's first, and a follow-up like "why does it rank there?" had no
 * antecedent to resolve. Asking who "it" is was the correct behaviour on the
 * input it was given, which is why it looked like a weak model rather than a
 * missing wire.
 *
 * The control test is the one that matters: the SAME follow-up without a
 * conversation id must still fail to resolve. Otherwise the pass proves only
 * that the phrasing happened to work.
 */

test.use({ storageState: STORAGE_STATE });
test.describe.configure({ mode: "serial" });

interface Turn {
  blocks: { type: string; [k: string]: unknown }[];
  conversationId: string | null;
  text: string;
}

async function ask(
  request: import("@playwright/test").APIRequestContext,
  message: string,
  conversationId?: string | null,
): Promise<Turn> {
  const res = await request.post("/api/copilot/stream", {
    data: { message, ...(conversationId ? { conversationId } : {}) },
  });
  expect(res.status()).toBe(200);
  const body = await res.text();

  const blocks: { type: string }[] = [];
  let id: string | null = null;
  for (const chunk of body.split("\n\n")) {
    const event = /^event: (\w+)/m.exec(chunk)?.[1];
    const raw = /^data: (.*)$/m.exec(chunk)?.[1];
    if (!event || !raw) continue;
    if (event === "block") blocks.push(JSON.parse(raw));
    if (event === "done") id = (JSON.parse(raw) as { conversationId?: string }).conversationId ?? null;
  }
  return { blocks, conversationId: id, text: JSON.stringify(blocks) };
}

test.describe("copilot conversation memory", () => {
  test("a follow-up resolves against what was said before", async ({ request }) => {
    const first = await ask(request, "ZZQA tell me about Alibaba");
    expect(first.conversationId, "the route must hand back a conversation id").toBeTruthy();
    expect(first.text).toContain("Alibaba");

    // "its" has no antecedent in this message alone.
    const second = await ask(request, "why is its score like that?", first.conversationId);
    expect(second.conversationId).toBe(first.conversationId);
    expect(second.text).toContain("Alibaba");
    expect(second.text).not.toContain("Which lead's score should I explain");
  });

  test("without the thread, the same follow-up cannot resolve", async ({ request }) => {
    // The control. If this passed too, the test above would be proving nothing.
    const orphan = await ask(request, "why is its score like that?");
    expect(orphan.text).toContain("Which lead's score should I explain");
  });

  test("the thread keeps growing rather than restarting", async ({ request }) => {
    const one = await ask(request, "ZZQA tell me about Fastweb&Vodafone");
    const two = await ask(request, "and how does it score?", one.conversationId);
    const three = await ask(request, "who owns it?", two.conversationId);
    expect(two.conversationId).toBe(one.conversationId);
    expect(three.conversationId).toBe(one.conversationId);
    // Three turns deep and the subject still holds.
    expect(three.text).toContain("Fastweb");
  });

  test("a conversation id that is not yours is ignored, not obeyed", async ({ request }) => {
    // Continuity must never become a way to read somebody else's thread.
    const turn = await ask(request, "why is its score like that?", "conv-does-not-exist");
    expect(turn.text).toContain("Which lead's score should I explain");
  });
});
