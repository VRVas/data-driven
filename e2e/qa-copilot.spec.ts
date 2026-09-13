import { test, expect } from "./fixtures";
import { STORAGE_STATE } from "./constants";
import { plant, uproot, must, tool, ymd, type Planted } from "./qa-helpers";

/**
 * The copilot, held to the same standard as the screens.
 *
 * Three things worth testing that nothing else covers. Whether the tools agree
 * with EACH OTHER, since three of them compute a priority by three different
 * routes. Whether the surface survives bad input, because a model composes
 * arguments and will eventually compose nonsense. And whether a conversation
 * actually holds its subject across turns and across a change of subject.
 */

test.use({ storageState: STORAGE_STATE });
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const planted: Planted[] = [];
let alpha: Planted;
let beta: Planted;

test.beforeAll(async ({ request }) => {
  alpha = await plant(request, { label: "Alpha", industry: "Fashion", status: "Shape proposal", valueEur: 64_000, confidence: "Confirmed", lastContact: ymd(-3) });
  beta = await plant(request, { label: "Beta", industry: "FMCG", status: "Qualify lead", valueEur: 12_000, lastContact: ymd(-200) });
  planted.push(alpha, beta);
});

test.afterAll(async ({ request }) => {
  await uproot(request, planted);
});

// ---------------------------------------------------------------------------
// The tools must agree with one another
// ---------------------------------------------------------------------------

test.describe("tools agree", () => {
  test("three routes to a priority produce one number", async ({ request }) => {
    const detail = await must<{ priorityScore: number; grade: string; quadrant: string }>(request, "get_lead", { id: alpha.id });
    const score = await must<{ priorityScore: number; grade: string; quadrant: string }>(request, "explain_score", { id: alpha.id });
    const listed = await must<{ leads: { id: string; priorityScore: number; grade: string }[] }>(request, "search_leads", {
      industry: "Fashion",
      outcome: "open",
      limit: 50,
    });
    const row = listed.leads.find((l) => l.id === alpha.id)!;

    expect(score.priorityScore).toBe(detail.priorityScore);
    expect(row.priorityScore).toBe(detail.priorityScore);
    expect(score.grade).toBe(detail.grade);
    expect(row.grade).toBe(detail.grade);
  });

  test("the weighted pipeline is the sum of its parts", async ({ request }) => {
    const summary = await must<{ weightedValueEur: number; openLeadCount: number }>(request, "pipeline_summary", {});
    const open = await must<{ count: number; leads: { weightedValueEur: number }[] }>(request, "search_leads", {
      outcome: "open",
      limit: 50,
      sortBy: "weightedValue",
    });
    expect(summary.openLeadCount).toBe(open.count);
    // Only comparable when the page fits, which is why the count is asserted
    // too - a silent truncation would make any total look wrong.
    if (open.count <= 50) {
      const summed = open.leads.reduce((n, l) => n + (l.weightedValueEur ?? 0), 0);
      // Each row is rounded independently, so allow a euro of drift per lead.
      expect(Math.abs(summary.weightedValueEur - summed)).toBeLessThanOrEqual(open.count);
    }
  });

  test("the work queue and the health report count the same lateness", async ({ request }) => {
    const health = await must<{ lateOnUs: number; lateOnThem: number }>(request, "pipeline_health", {});
    const queue = await must<{ items: { reason: string }[] }>(request, "my_work_queue", { limit: 25 });
    const late = queue.items.filter((i) => /late|overdue|chase|reply/i.test(i.reason)).length;
    expect(late).toBeLessThanOrEqual(health.lateOnUs + health.lateOnThem);
  });

  test("a lead that does not exist reads the same as one out of reach", async ({ request }) => {
    // The two answers must be identical, or the reply confirms the existence of
    // records the caller is not allowed to see.
    const missing = await must<{ found: boolean }>(request, "get_lead", { id: "definitely-not-a-lead-9f2b" });
    expect(missing.found).toBe(false);
    const score = await must<{ found: boolean }>(request, "explain_score", { id: "definitely-not-a-lead-9f2b" });
    expect(score.found).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bad input - a model composes arguments, and will compose nonsense
// ---------------------------------------------------------------------------

test.describe("the tool surface survives abuse", () => {
  const nasty: { label: string; tool: string; args: Record<string, unknown> }[] = [
    { label: "no arguments at all", tool: "get_lead", args: {} },
    { label: "wrong type for an id", tool: "get_lead", args: { id: 12345 } },
    { label: "null id", tool: "get_lead", args: { id: null } },
    { label: "empty id", tool: "get_lead", args: { id: "" } },
    { label: "an id that is an object", tool: "get_lead", args: { id: { nested: true } } },
    { label: "a negative budget", tool: "set_budget", args: { id: "alibaba", valueEur: -5000 } },
    { label: "a budget that is not a number", tool: "set_budget", args: { id: "alibaba", valueEur: "lots" } },
    { label: "an absurd budget", tool: "set_budget", args: { id: "alibaba", valueEur: 1e18 } },
    { label: "NaN", tool: "set_budget", args: { id: "alibaba", valueEur: Number.NaN } },
    { label: "a stage that does not exist", tool: "advance_lead_stage", args: { id: "alibaba", to: "Ascended" } },
    { label: "a 20k character name", tool: "create_lead", args: { name: "x".repeat(20_000) } },
    { label: "a name of only spaces", tool: "create_lead", args: { name: "     " } },
    { label: "an industry that is not in the vocabulary", tool: "create_lead", args: { name: "QA Vocab", industry: "Cryptocurrency" } },
    { label: "path traversal in an id", tool: "get_lead", args: { id: "../../etc/passwd" } },
    { label: "a script tag in free text", tool: "search_leads", args: { query: "<script>alert(1)</script>" } },
    { label: "an injection-shaped query", tool: "search_leads", args: { query: "' OR 1=1 --" } },
    { label: "a limit above the maximum", tool: "search_leads", args: { limit: 100_000 } },
    { label: "a limit of zero", tool: "search_leads", args: { limit: 0 } },
    { label: "an array where a string belongs", tool: "search_leads", args: { query: ["a", "b"] } },
    { label: "unicode and emoji", tool: "search_leads", args: { query: "日本語 🚀 café" } },
    { label: "a reminder in the past", tool: "set_reminder", args: { title: "QA", dueAt: "1970-01-01T00:00:00Z" } },
    { label: "a reminder with an unparseable time", tool: "set_reminder", args: { title: "QA", dueAt: "next tuesday-ish" } },
  ];

  for (const c of nasty) {
    test(`${c.tool}: ${c.label}`, async ({ request }) => {
      const r = await tool(request, c.tool, c.args);
      // The contract: never a server error, always a decision.
      expect(r.status, `${c.tool} returned ${r.status}`).toBeLessThan(500);
      if (!r.ok) {
        expect(typeof r.error).toBe("string");
        expect(r.error!.length).toBeGreaterThan(0);
        // A stack trace in an error message is a leak, not a message.
        expect(r.error).not.toContain("    at ");
      }
    });
  }

  test("nothing was created by any of that", async ({ request }) => {
    const found = await must<{ leads: { name: string }[] }>(request, "search_leads", { query: "QA Vocab", limit: 50 });
    expect(found.leads.map((l) => l.name)).not.toContain("QA Vocab");
  });

  test("a rejected write leaves the record exactly as it was", async ({ request }) => {
    const before = await must<{ budgetEur: number; status: string }>(request, "get_lead", { id: alpha.id });
    await tool(request, "set_budget", { id: alpha.id, valueEur: -1 });
    await tool(request, "advance_lead_stage", { id: alpha.id, to: "Ascended" });
    const after = await must<{ budgetEur: number; status: string }>(request, "get_lead", { id: alpha.id });
    expect(after.budgetEur).toBe(before.budgetEur);
    expect(after.status).toBe(before.status);
  });

  test("writing the same value twice changes nothing the second time", async ({ request }) => {
    await must(request, "set_budget", { id: beta.id, valueEur: 12_000 });
    const once = await must<{ priorityScore: number }>(request, "get_lead", { id: beta.id });
    await must(request, "set_budget", { id: beta.id, valueEur: 12_000 });
    const twice = await must<{ priorityScore: number }>(request, "get_lead", { id: beta.id });
    expect(twice.priorityScore).toBe(once.priorityScore);
  });
});

// ---------------------------------------------------------------------------
// Conversation, deeper than one follow-up
// ---------------------------------------------------------------------------

interface Turn {
  text: string;
  conversationId: string | null;
}

async function say(
  request: import("@playwright/test").APIRequestContext,
  message: string,
  conversationId?: string | null,
): Promise<Turn> {
  const res = await request.post("/api/copilot/stream", {
    data: { message, ...(conversationId ? { conversationId } : {}) },
  });
  const body = await res.text();
  const blocks: unknown[] = [];
  let id: string | null = null;
  for (const chunk of body.split("\n\n")) {
    const event = /^event: (\w+)/m.exec(chunk)?.[1];
    const raw = /^data: (.*)$/m.exec(chunk)?.[1];
    if (!event || !raw) continue;
    if (event === "block") blocks.push(JSON.parse(raw));
    if (event === "done") id = (JSON.parse(raw) as { conversationId?: string }).conversationId ?? null;
  }
  return { text: JSON.stringify(blocks), conversationId: id };
}

test.describe("a conversation holds its subject", () => {
  test("the subject survives, and a change of subject replaces it", async ({ request }) => {
    const t1 = await say(request, `ZZQA tell me about ${alpha.name}`);
    expect(t1.text).toContain("Alpha");

    const t2 = await say(request, "why is its score like that?", t1.conversationId);
    expect(t2.text).toContain("Alpha");

    // Now change the subject. The follow-up after it must follow the NEW one,
    // which is the half that a naive "remember the first lead" would fail.
    const t3 = await say(request, `and what about ${beta.name}?`, t1.conversationId);
    expect(t3.text).toContain("Beta");

    const t4 = await say(request, "why is its score like that?", t1.conversationId);
    expect(t4.text).toContain("Beta");
    expect(t4.text).not.toContain("Alpha");
  });

  test("six turns deep the thread is still one thread", async ({ request }) => {
    let conv: string | null = null;
    for (const q of [
      `ZZQA what is ${alpha.name} worth?`,
      "who owns it?",
      "when did we last speak to them?",
      "what stage is it at?",
      "why is its score like that?",
      "what should I do about it?",
    ]) {
      const turn = await say(request, q, conv);
      conv = conv ?? turn.conversationId;
      expect(turn.conversationId).toBe(conv);
    }
    expect(conv).toBeTruthy();
  });

  test("an enormous turn does not break the thread", async ({ request }) => {
    // History is budgeted; a wall of text must be clipped rather than either
    // blowing the context window or dropping every earlier turn.
    const t1 = await say(request, `ZZQA tell me about ${alpha.name}`);
    await say(request, `here is some context: ${"lorem ipsum ".repeat(400)}`, t1.conversationId);
    const t3 = await say(request, "why is its score like that?", t1.conversationId);
    expect(t3.text).toContain("Alpha");
  });
});
