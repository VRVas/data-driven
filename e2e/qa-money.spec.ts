import { test, expect } from "./fixtures";
import { STORAGE_STATE } from "./constants";
import { QA, plant, uproot, must, tool, ymd, type Planted } from "./qa-helpers";

/**
 * Money, paperwork and the client relationship.
 *
 * These are the numbers that span records, which is where a CRM actually goes
 * wrong: one deal showing two values on two screens, a won deal counted as
 * pipeline, an acceptance quietly overturned by a later draft. Each test walks
 * a record through a real sequence and checks the arithmetic at every surface
 * that reports it.
 */

test.use({ storageState: STORAGE_STATE });
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const planted: Planted[] = [];

test.afterAll(async ({ request }) => {
  await uproot(request, planted);
});

async function grow(request: import("@playwright/test").APIRequestContext, label: string, extra = {}) {
  const p = await plant(request, { label, industry: "Fashion", status: "Early", lastContact: ymd(-2), ...extra });
  planted.push(p);
  return p;
}

// ---------------------------------------------------------------------------
// One deal, one value - whatever the evidence
// ---------------------------------------------------------------------------

test.describe("the value follows the strongest evidence", () => {
  let lead: Planted;

  test("an estimate is what an estimate is", async ({ request }) => {
    lead = await grow(request, "Paper", { valueEur: 40_000 });
    const d = await must<{ budgetEur: number; budgetOutlook: { estimatedEur: number; acceptedEur: number | null } }>(
      request,
      "get_lead",
      { id: lead.id },
    );
    expect(d.budgetEur).toBe(40_000);
    expect(d.budgetOutlook.acceptedEur).toBeNull();
  });

  test("a sent proposal outranks the estimate that preceded it", async ({ request }) => {
    await must(request, "record_proposal", { leadId: lead.id, valueEur: 60_000, status: "sent", sentAt: ymd(-3) });
    const d = await must<{ budgetEur: number }>(request, "get_lead", { id: lead.id });
    expect(d.budgetEur).toBe(60_000);
  });

  test("money out for a decision is counted as exactly that", async ({ request }) => {
    const health = await must<{ awaitingGreenlightEur: number }>(request, "pipeline_health", {});
    expect(health.awaitingGreenlightEur).toBeGreaterThanOrEqual(60_000);
  });

  test("accepting confirms the figure and freezes the original guess", async ({ request }) => {
    const proposals = await must<{ proposals: { id: string; dealId: string; valueEur: number }[] }>(
      request,
      "get_company",
      { id: lead.id },
    );
    const sent = proposals.proposals.find((p) => p.dealId === lead.id)!;
    await must(request, "record_proposal", { leadId: lead.id, valueEur: 60_000, status: "accepted", sentAt: ymd(-3) });
    expect(sent.valueEur).toBe(60_000);

    const d = await must<{
      budgetEur: number;
      budgetOutlook: { estimatedEur: number | null; acceptedEur: number | null; deltaEur: number | null };
    }>(request, "get_lead", { id: lead.id });
    expect(d.budgetEur).toBe(60_000);
    expect(d.budgetOutlook.acceptedEur).toBe(60_000);
    // The guess is kept so estimate-versus-accepted stays answerable.
    expect(d.budgetOutlook.estimatedEur).toBe(40_000);
    expect(d.budgetOutlook.deltaEur).toBe(20_000);
  });

  test("a later re-quote cannot overturn an acceptance", async ({ request }) => {
    // An acceptance is a fact and does not expire. A rejected re-quote after it
    // is a separate negotiation, not a correction.
    await must(request, "record_proposal", { leadId: lead.id, valueEur: 90_000, status: "rejected", sentAt: ymd(-1) });
    const d = await must<{ budgetEur: number; budgetOutlook: { acceptedEur: number | null } }>(request, "get_lead", {
      id: lead.id,
    });
    expect(d.budgetOutlook.acceptedEur).toBe(60_000);
    expect(d.budgetEur).toBe(60_000);
  });

  test("every surface reports that one figure identically", async ({ page, request }) => {
    const fromTool = await must<{ budgetEur: number }>(request, "get_lead", { id: lead.id });
    const fromCompany = await must<{ deals: { id: string; budgetEur: number }[] }>(request, "get_company", {
      id: lead.id,
    });
    expect(fromCompany.deals.find((d) => d.id === lead.id)!.budgetEur).toBe(fromTool.budgetEur);

    await page.goto(`/dashboard/pipeline/${lead.id}`);
    await expect(page.locator("body")).toContainText("60,000");

    await page.goto("/dashboard/pipeline");
    await page.getByPlaceholder("Search brand, POC, notes").fill(`${QA} Paper`);
    await expect(page.locator("tr", { hasText: `${QA} Paper` }).first()).toContainText("60,000");
  });
});

// ---------------------------------------------------------------------------
// A client is not a deal
// ---------------------------------------------------------------------------

test.describe("company rollups add up", () => {
  let first: Planted;
  let companyId: string;

  test("a second deal joins the client rather than inventing one", async ({ request }) => {
    first = await grow(request, "Rollup One", { valueEur: 30_000, status: "Deal Closed", confidence: "Confirmed" });
    const detail = await must<{ company: { id: string; name: string } }>(request, "get_company", { id: first.id });
    companyId = detail.company.id;

    const second = await must<{ id: string; linkedToCompany: string | null }>(request, "create_lead", {
      name: `${QA} Rollup Two`,
      industry: "Fashion",
      status: "Advanced",
      valueEur: 50_000,
      companyId,
    });
    planted.push({ id: second.id, name: `${QA} Rollup Two` });
    expect(second.linkedToCompany).toBe(detail.company.name);
  });

  test("lifetime value is what was won, pipeline is what is live", async ({ request }) => {
    const d = await must<{
      company: { lifetimeValueEur: number; openPipelineEur: number; wonDealCount: number; openDealCount: number };
      deals: { id: string }[];
    }>(request, "get_company", { id: companyId });

    expect(d.deals.length).toBeGreaterThanOrEqual(2);
    expect(d.company.wonDealCount).toBe(1);
    expect(d.company.openDealCount).toBe(1);
    // The won 30k is banked; the live 50k is not. Neither is both.
    expect(d.company.lifetimeValueEur).toBe(30_000);
    expect(d.company.openPipelineEur).toBe(50_000);
  });

  test("a third win is repeat business, the first never is", async ({ request }) => {
    const third = await must<{ id: string }>(request, "create_lead", {
      name: `${QA} Rollup Three`,
      industry: "Fashion",
      status: "Deal Closed",
      valueEur: 20_000,
      companyId,
    });
    planted.push({ id: third.id, name: `${QA} Rollup Three` });
    await must(request, "set_budget", { id: third.id, valueEur: 20_000, confidence: "Confirmed" });

    const d = await must<{ company: { lifetimeValueEur: number; repeatValueEur: number } }>(request, "get_company", {
      id: companyId,
    });
    expect(d.company.lifetimeValueEur).toBe(50_000);
    // Repeat is everything beyond the first win, not everything won.
    expect(d.company.repeatValueEur).toBe(20_000);
  });

  test("the company page shows the same rollup the tool reports", async ({ page, request }) => {
    const d = await must<{ company: { lifetimeValueEur: number; openPipelineEur: number } }>(request, "get_company", {
      id: companyId,
    });
    await page.goto(`/dashboard/companies/${companyId}`);
    const body = await page.locator("body").innerText();
    expect(body).toContain(d.company.lifetimeValueEur.toLocaleString("en-IE"));
    expect(body).toContain(d.company.openPipelineEur.toLocaleString("en-IE"));
  });
});

// ---------------------------------------------------------------------------
// Dates that make no sense
// ---------------------------------------------------------------------------

test.describe("nonsense dates are refused, not absorbed", () => {
  test("a deal that closes before it opens does not score a perfect tempo", async ({ request }) => {
    const p = await grow(request, "Backwards", {
      valueEur: 40_000,
      status: "Deal Closed",
      initialContact: ymd(-30),
      closingFailed: ymd(-400),
    });
    const d = await must<{ pace: { months: number | null; basis: string } }>(request, "get_lead", { id: p.id });
    // A negative span used to clamp to zero months, which is the fastest deal
    // imaginable and therefore the best possible tempo score.
    expect(d.pace.months === null || d.pace.months >= 0).toBe(true);
    if (d.pace.months !== null) expect(d.pace.months).toBeGreaterThan(0);
  });

  test("a malformed date is rejected rather than stored", async ({ request }) => {
    const p = await grow(request, "BadDate", { valueEur: 10_000 });
    const r = await tool(request, "set_next_move", { id: p.id, followUpDate: "31/12/2026" });
    expect(r.ok).toBe(true);
    expect((r.data as { ok: boolean; error?: string }).ok).toBe(false);

    const after = await must<{ followUpDate: string | null }>(request, "get_lead", { id: p.id });
    expect(after.followUpDate).toBeNull();
  });

  test("a follow-up far in the future is not overdue", async ({ request }) => {
    const p = await grow(request, "Future", { valueEur: 10_000, followUpDate: ymd(400), waitingOn: "them" });
    const d = await must<{ nextMove: { daysLate: number; lateOnThem: boolean } }>(request, "get_lead", { id: p.id });
    expect(d.nextMove.lateOnThem).toBe(false);
    expect(d.nextMove.daysLate).toBeLessThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Stage transitions
// ---------------------------------------------------------------------------

test.describe("the workflow refuses illegal moves", () => {
  test("a legal step through the funnel is accepted", async ({ request }) => {
    const p = await grow(request, "Walker", { valueEur: 25_000, status: "Still to open" });
    for (const to of ["Early", "Follow Up", "Advanced"]) {
      const r = await must<{ ok: boolean; status: string }>(request, "advance_lead_stage", { id: p.id, to });
      expect(r.ok, `refused ${to}`).toBe(true);
      expect(r.status).toBe(to);
    }
  });

  test("a jump the funnel does not allow is refused, and changes nothing", async ({ request }) => {
    const p = await grow(request, "Jumper", { valueEur: 25_000, status: "Still to open" });
    const r = await must<{ ok: boolean; error?: string }>(request, "advance_lead_stage", { id: p.id, to: "Deal Closed" });
    expect(r.ok).toBe(false);
    const after = await must<{ status: string }>(request, "get_lead", { id: p.id });
    expect(after.status).toBe("Still to open");
  });
});
