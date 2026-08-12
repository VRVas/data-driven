import { test, expect } from "./fixtures";
import { STORAGE_STATE } from "./constants";

/**
 * The copilot tool surface, exercised through the real API route so the
 * permission gate, the record scope and each tool's own logic all run.
 *
 * The seeded E2E account is the founding user and holds the administrator
 * profile, so anything refused here is refused on its merits.
 */

test.use({ storageState: STORAGE_STATE });

/** POST a tool and return its parsed body. */
async function callTool(request: import("@playwright/test").APIRequestContext, name: string, args: Record<string, unknown> = {}) {
  const res = await request.post(`/api/copilot/tools/${name}`, { data: args });
  return { status: res.status(), body: (await res.json()) as { ok: boolean; data?: Record<string, unknown>; error?: string } };
}

test.describe("copilot read tools", () => {
  test("pipeline_health separates what we owe from what they owe", async ({ request }) => {
    const { status, body } = await callTool(request, "pipeline_health");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const d = body.data!;
    expect(typeof d.lateOnUs).toBe("number");
    expect(typeof d.lateOnThem).toBe("number");
    expect(typeof d.untriaged).toBe("number");
    expect(typeof d.awaitingGreenlightEur).toBe("number");
    expect(Number(d.openLeads)).toBeGreaterThan(0);
  });

  test("data_quality reports what is missing or contradictory", async ({ request }) => {
    const { body } = await callTool(request, "data_quality");
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data!.issues)).toBe(true);
    expect(Array.isArray(body.data!.outcomeConflicts)).toBe(true);
    expect(typeof body.data!.openLeadsWithoutFollowUp).toBe("number");
  });

  test("tempo_report distinguishes measured duration from estimates", async ({ request }) => {
    const { body } = await callTool(request, "tempo_report");
    expect(body.ok).toBe(true);
    const d = body.data!;
    expect(Number(d.closedDealsMeasured)).toBeGreaterThan(0);
    expect(Number(d.openDealsEstimated)).toBeGreaterThan(0);
    expect(Array.isArray(d.worstOverruns)).toBe(true);
  });

  test("budget_accuracy answers even before any offer is accepted", async ({ request }) => {
    const { body } = await callTool(request, "budget_accuracy");
    expect(body.ok).toBe(true);
    expect(typeof body.data!.dealsWithBothNumbers).toBe("number");
  });

  test("duplicate_companies suggests without merging", async ({ request }) => {
    const { body } = await callTool(request, "duplicate_companies");
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data!.groups)).toBe(true);
    expect(String(body.data!.note)).toContain("human decision");
  });

  test("money_at_risk returns the waiting queue", async ({ request }) => {
    const { body } = await callTool(request, "money_at_risk");
    expect(body.ok).toBe(true);
    expect(typeof body.data!.totalEur).toBe("number");
    expect(Array.isArray(body.data!.proposals)).toBe(true);
  });

  test("outreach_status reads the outbox", async ({ request }) => {
    const { body } = await callTool(request, "outreach_status");
    expect(body.ok).toBe(true);
    expect(typeof body.data!.total).toBe("number");
  });

  test("lead_history returns the audit trail for a lead", async ({ request }) => {
    const { body } = await callTool(request, "lead_history", { id: "alibaba" });
    expect(body.ok).toBe(true);
    expect(body.data!.found).toBe(true);
    expect(Array.isArray(body.data!.history)).toBe(true);
  });

  test("get_lead carries the next move, the pace and the budget outlook", async ({ request }) => {
    const { body } = await callTool(request, "get_lead", { id: "alibaba" });
    expect(body.ok).toBe(true);
    const d = body.data!;
    expect(d.found).toBe(true);
    expect(d.nextMove).toBeTruthy();
    expect(d.pace).toBeTruthy();
    expect(d.budgetOutlook).toBeTruthy();
    expect(d.priorityScore).not.toBeUndefined();
  });

  test("a lead that does not exist reads as not found, never as an error", async ({ request }) => {
    const { body } = await callTool(request, "get_lead", { id: "no-such-lead" });
    expect(body.ok).toBe(true);
    expect(body.data!.found).toBe(false);
  });
});

test.describe("copilot write tools", () => {
  test("set_next_move records the side, the step and the date", async ({ request }) => {
    const { body } = await callTool(request, "set_next_move", {
      id: "alleanza",
      waitingOn: "them",
      nextStep: "Chase for a decision",
      followUpDate: "2026-09-01",
    });
    expect(body.ok).toBe(true);
    expect(body.data!.waitingOn).toBe("them");
    expect(body.data!.followUpDate).toBe("2026-09-01");

    // It has to survive a read, not just return a cheerful response.
    const after = await callTool(request, "get_lead", { id: "alleanza" });
    expect((after.body.data!.nextMove as Record<string, unknown>).waitingOn).toBe("them");
    expect(after.body.data!.nextStep).toBe("Chase for a decision");
  });

  test("set_next_move rejects a malformed date rather than storing it", async ({ request }) => {
    const { body } = await callTool(request, "set_next_move", { id: "alleanza", followUpDate: "next tuesday" });
    expect(body.data!.ok).toBe(false);
    expect(String(body.data!.error)).toContain("YYYY-MM-DD");
  });

  test("snooze then complete a follow-up", async ({ request }) => {
    const snoozed = await callTool(request, "snooze_follow_up", { id: "alleanza", days: 14 });
    expect(snoozed.body.ok).toBe(true);
    expect(String(snoozed.body.data!.followUpDate)).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const done = await callTool(request, "complete_follow_up", { id: "alleanza" });
    expect(done.body.ok).toBe(true);
    const after = await callTool(request, "get_lead", { id: "alleanza" });
    expect((after.body.data!.timeline as Record<string, unknown>).followUpDate).toBeNull();
  });

  test("set_strategic_value is what lets a free project stay visible", async ({ request }) => {
    const { body } = await callTool(request, "set_strategic_value", {
      id: "alleanza",
      value: 3,
      reason: "Referral source",
    });
    expect(body.ok).toBe(true);
    expect(body.data!.strategicValue).toBe(3);

    const after = await callTool(request, "get_lead", { id: "alleanza" });
    expect(after.body.data!.strategicValue).toBe(3);
    expect(after.body.data!.strategicReason).toBe("Referral source");
  });

  test("record_proposal adds a revision and confirms the budget on accept", async ({ request }) => {
    // A fresh amount every run: confirming the value a previous run already
    // wrote is a legitimate no-op, which would hide a real regression here.
    const value = 40_000 + (Date.now() % 5_000);

    const sent = await callTool(request, "record_proposal", { leadId: "bnl-bnp", valueEur: 31000, status: "sent" });
    expect(sent.body.ok).toBe(true);
    expect(Number(sent.body.data!.revision)).toBeGreaterThanOrEqual(1);

    const accepted = await callTool(request, "record_proposal", { leadId: "bnl-bnp", valueEur: value, status: "accepted" });
    expect(accepted.body.ok).toBe(true);
    // Accepting is what turns the guess into a fact, and it reports both halves
    // so the caller can see what the estimate was worth.
    const confirmed = accepted.body.data!.confirmedBudget as { accepted: number; estimated: number | null };
    expect(confirmed.accepted).toBe(value);
    expect(confirmed.estimated).toBe(40000);

    const after = await callTool(request, "get_lead", { id: "bnl-bnp" });
    const outlook = after.body.data!.budgetOutlook as Record<string, unknown>;
    expect(outlook.acceptedEur).toBe(value);
    // The opening guess survives being overwritten: that is the whole point of
    // capturing it once.
    expect(outlook.estimatedEur).not.toBeNull();
  });

  test("an unknown lead is refused rather than half-written", async ({ request }) => {
    const { body } = await callTool(request, "set_next_move", { id: "not-a-lead", waitingOn: "us" });
    expect(body.data!.ok).toBe(false);
    expect(String(body.data!.error)).toContain("not found");
  });
});

test.describe("copilot tool gating", () => {
  test("an unknown tool is a 404, not a silent success", async ({ request }) => {
    const res = await request.post("/api/copilot/tools/no_such_tool", { data: {} });
    expect(res.status()).toBe(404);
  });

  test("the OpenAPI document lists every tool for a signed-in caller", async ({ request }) => {
    const res = await request.get("/api/copilot/openapi");
    expect(res.status()).toBe(200);
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths).length).toBeGreaterThanOrEqual(27);
    expect(doc.paths["/api/copilot/tools/set_next_move"]).toBeTruthy();
    expect(doc.paths["/api/copilot/tools/pipeline_health"]).toBeTruthy();
  });
});

test.describe("copilot tools without a session", () => {
  // An empty storage state rather than a new context: browser.newContext()
  // inherits the project's auth, which quietly made this pass against a
  // signed-in caller.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the tools are an open door to nobody", async ({ request }) => {
    const res = await request.post("/api/copilot/tools/pipeline_health", { data: {} });
    expect(res.status()).toBe(401);
  });

  test("the OpenAPI document is not served anonymously", async ({ request }) => {
    // It is a map of the internal API; publishing it is free reconnaissance.
    const res = await request.get("/api/copilot/openapi");
    expect(res.status()).toBe(401);
  });
});
