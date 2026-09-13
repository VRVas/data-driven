import { test, expect } from "./fixtures";
import { STORAGE_STATE } from "./constants";
import { QA, plant, uproot, must, tool, priorityOf, ymd, type Planted } from "./qa-helpers";

/**
 * The scoring model, checked against planted data rather than against itself.
 *
 * Every existing test asks whether a number renders. These ask whether it is
 * the RIGHT number, by planting leads that differ in exactly one thing and
 * asserting the direction and often the magnitude of the difference. A model
 * can be internally consistent and still wrong; a controlled pair catches that,
 * a single lead never does.
 */

test.use({ storageState: STORAGE_STATE });
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const planted: Planted[] = [];
const keep = async (p: Promise<Planted>) => {
  const r = await p;
  planted.push(r);
  return r;
};

let capped: Planted;
let outlier: Planted;
let zero: Planted;
let unset: Planted;
let confirmed: Planted;
let estimated: Planted;
let stale: Planted;
let fresh: Planted;
let charity: Planted;
let advanced: Planted;
let won: Planted;
let lost: Planted;

test.beforeAll(async ({ request }) => {
  // Pairs. Each differs from its partner in ONE field.
  // Both of these must clear the cap AFTER the confidence discount, or the
  // pair is testing the discount rather than the cap.
  capped = await keep(plant(request, { label: "Capped", industry: "Fashion", status: "Qualify lead", valueEur: 80_000, confidence: "Confirmed", lastContact: ymd(-1) }));
  outlier = await keep(plant(request, { label: "Outlier", industry: "Fashion", status: "Qualify lead", valueEur: 10_000_000, confidence: "Confirmed", lastContact: ymd(-1) }));
  zero = await keep(plant(request, { label: "Zero", industry: "Fashion", status: "Qualify lead", valueEur: 0, lastContact: ymd(-1) }));
  unset = await keep(plant(request, { label: "Unset", industry: "Fashion", status: "Qualify lead", lastContact: ymd(-1) }));

  confirmed = await keep(plant(request, { label: "Confirmed", industry: "Fashion", status: "Qualify lead", valueEur: 50_000, confidence: "Confirmed", lastContact: ymd(-1) }));
  estimated = await keep(plant(request, { label: "Estimated", industry: "Fashion", status: "Qualify lead", valueEur: 50_000, confidence: "Estimated", lastContact: ymd(-1) }));

  fresh = await keep(plant(request, { label: "Fresh", industry: "Fashion", status: "Qualify lead", valueEur: 50_000, lastContact: ymd(-1) }));
  stale = await keep(plant(request, { label: "Stale", industry: "Fashion", status: "Qualify lead", valueEur: 50_000, lastContact: ymd(-370) }));

  advanced = await keep(plant(request, { label: "Shape proposal", industry: "Fashion", status: "Shape proposal", valueEur: 50_000, lastContact: ymd(-1) }));
  charity = await keep(plant(request, { label: "Charity", industry: "Fashion", status: "Qualify lead", valueEur: 0, strategicValue: 3, lastContact: ymd(-1) }));

  won = await keep(plant(request, { label: "Won", industry: "Fashion", status: "Closed deal", valueEur: 45_000, confidence: "Confirmed" }));
  lost = await keep(plant(request, { label: "Lost", industry: "Fashion", status: "Lost", valueEur: 45_000 }));
});

test.afterAll(async ({ request }) => {
  await uproot(request, planted);
});

// ---------------------------------------------------------------------------
// The opportunity axis
// ---------------------------------------------------------------------------

test.describe("opportunity", () => {
  test("a huge deal scores exactly the same as one at the cap", async ({ request }) => {
    // The cap is the whole point: beyond EUR 80k of EVIDENCE-ADJUSTED value,
    // more money buys no more rank, or one enormous deal would flatten every
    // other lead in the book.
    const a = await priorityOf(request, capped.id);
    const b = await priorityOf(request, outlier.id);
    expect(a.opportunity!.moneyIndex).toBe(100);
    expect(b.opportunity!.moneyIndex).toBe(100);
    expect(b.opportunity!.score).toBe(a.opportunity!.score);
    expect(b.priorityScore).toBe(a.priorityScore);
    // The raw figure is still carried uncapped, for anything that needs the
    // real number rather than the index.
    expect(b.opportunity!.adjustedBudgetEur).toBeGreaterThan(a.opportunity!.adjustedBudgetEur);
  });

  test("a deal worth nothing scores zero however winnable it is", async ({ request }) => {
    const z = await priorityOf(request, zero.id);
    expect(z.opportunity!.score).toBe(0);
    // Geometric mean: a zero on either axis is fatal, and this is the axis
    // where a zero is actually reachable.
    expect(z.priorityScore).toBe(0);
    expect(z.winnability!.score).toBeGreaterThan(0);
  });

  test("an unstated value is discounted harder than a stated one", async ({ request }) => {
    const u = await must<{ found: boolean; budgetEur: number | null; priority: number | null }>(request, "get_lead", { id: unset.id });
    expect(u.budgetEur).toBeNull();
    expect(u.priority ?? 0).toBe(0);
  });

  test("confirmed money counts for more than an estimate of the same size", async ({ request }) => {
    const c = await priorityOf(request, confirmed.id);
    const e = await priorityOf(request, estimated.id);
    // Confidence 1.0 against 0.6 on an identical EUR 50k.
    expect(c.opportunity!.adjustedBudgetEur).toBe(50_000);
    expect(e.opportunity!.adjustedBudgetEur).toBe(30_000);
    expect(c.opportunity!.score).toBeGreaterThan(e.opportunity!.score);
    expect(c.priorityScore!).toBeGreaterThan(e.priorityScore!);
  });

  test("a free flagship stays visible without outranking paid work", async ({ request }) => {
    const free = await priorityOf(request, charity.id);
    const paid = await priorityOf(request, estimated.id);
    // Strategic value is capped at a quarter of the axis, so a 3/3 with no
    // money lands at 25 - present, and below a real deal.
    expect(free.opportunity!.moneyIndex).toBe(0);
    expect(free.opportunity!.score).toBe(25);
    expect(free.priorityScore!).toBeGreaterThan(0);
    expect(free.priorityScore!).toBeLessThan(paid.priorityScore!);
  });
});

// ---------------------------------------------------------------------------
// The winnability axis
// ---------------------------------------------------------------------------

test.describe("winnability", () => {
  test("going quiet costs rank without removing the lead", async ({ request }) => {
    const f = await priorityOf(request, fresh.id);
    const s = await priorityOf(request, stale.id);
    // Halves every six months, floored at a quarter: a year of silence is
    // about two halvings.
    expect(s.winnability!.score).toBeLessThan(f.winnability!.score);
    expect(s.priorityScore!).toBeLessThan(f.priorityScore!);
    expect(s.priorityScore!).toBeGreaterThan(0);
    expect(f.opportunity!.score).toBe(s.opportunity!.score);
  });

  test("a later stage is worth more than an earlier one, all else equal", async ({ request }) => {
    const early = await priorityOf(request, fresh.id);
    const late = await priorityOf(request, advanced.id);
    expect(late.winnability!.score).toBeGreaterThan(early.winnability!.score);
    expect(late.opportunity!.score).toBe(early.opportunity!.score);
    expect(late.priorityScore!).toBeGreaterThan(early.priorityScore!);
  });

  test("the two axes move independently", async ({ request }) => {
    // If a change to money moved winnability, or a change to recency moved
    // opportunity, the geometric mean would be measuring one thing twice.
    const [c, e, f, s] = await Promise.all([
      priorityOf(request, confirmed.id),
      priorityOf(request, estimated.id),
      priorityOf(request, fresh.id),
      priorityOf(request, stale.id),
    ]);
    expect(c.winnability!.score).toBe(e.winnability!.score);
    expect(f.opportunity!.score).toBe(s.opportunity!.score);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle - what a finished deal is and is not part of
// ---------------------------------------------------------------------------

test.describe("won and lost", () => {
  test("an unqualified ranking covers live deals only", async ({ request }) => {
    const ranked = await must<{ outcomeFilter: string; leads: { id: string }[] }>(request, "search_leads", {
      industry: "Fashion",
      outcome: "open",
      limit: 50,
    });
    expect(ranked.outcomeFilter).toBe("open");
    const ids = ranked.leads.map((l) => l.id);
    expect(ids).toContain(capped.id);
    expect(ids).not.toContain(won.id);
    expect(ids).not.toContain(lost.id);
  });

  test("a free-text query is a search, and says so", async ({ request }) => {
    // Deliberate: looking a name up must find it whatever happened to the deal.
    // The reply has to declare it, or the model will call the result pipeline.
    const found = await must<{ outcomeFilter: string; leads: { id: string }[] }>(request, "search_leads", {
      query: QA,
      limit: 50,
    });
    expect(found.outcomeFilter).toBe("any");
    expect(found.leads.map((l) => l.id)).toContain(won.id);
  });

  test("asking for them explicitly brings them back", async ({ request }) => {
    const all = await must<{ leads: { id: string }[] }>(request, "search_leads", { query: QA, outcome: "any", limit: 50 });
    const ids = all.leads.map((l) => l.id);
    expect(ids).toContain(won.id);
    expect(ids).toContain(lost.id);
  });

  test("a won deal leaves the pipeline and joins lifetime value", async ({ request }) => {
    const detail = await must<{
      company: { name: string; lifetimeValueEur: number; openPipelineEur: number; wonDealCount: number };
      deals: { id: string; outcome: string }[];
    }>(request, "get_company", { id: won.id });

    expect(detail.deals.map((d) => d.id)).toContain(won.id);
    expect(detail.company.wonDealCount).toBeGreaterThanOrEqual(1);
    expect(detail.company.lifetimeValueEur).toBeGreaterThanOrEqual(45_000);
    // Banked money is not pipeline.
    expect(detail.company.openPipelineEur).toBe(0);
  });

  test("a lost deal is worth nothing anywhere", async ({ request }) => {
    const detail = await must<{ company: { lifetimeValueEur: number; openPipelineEur: number } }>(request, "get_company", {
      id: lost.id,
    });
    expect(detail.company.lifetimeValueEur).toBe(0);
    expect(detail.company.openPipelineEur).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The screens must agree with the model
// ---------------------------------------------------------------------------

test.describe("screens agree with the model", () => {
  test("the lead page shows the same priority the tool computes", async ({ page, request }) => {
    const p = await priorityOf(request, estimated.id);
    await page.goto(`/dashboard/pipeline/${estimated.id}`);
    const body = await page.locator("body").innerText();
    expect(body).toContain(String(p.priorityScore));
    expect(body).toContain(p.grade!);
    expect(body).toContain(p.quadrant!);
  });

  test("the pipeline row shows the same value the model was given", async ({ page }) => {
    await page.goto("/dashboard/pipeline");
    await page.getByPlaceholder("Search brand, POC, notes").fill(`${QA} Confirmed`);
    const row = page.locator("tr", { hasText: `${QA} Confirmed` }).first();
    await expect(row).toContainText("50,000");
  });

  test("a lead with no value reads as unrankable rather than as zero", async ({ page }) => {
    await page.goto(`/dashboard/pipeline/${unset.id}`);
    const body = await page.locator("body").innerText();
    // The distinction matters: nothing typed is not the same claim as "worth
    // nothing". Expected value used to fall back to a weighted zero and print
    // a confident EUR 0 beside a Budget that correctly said "-".
    expect(body).not.toContain("€0");
    expect(body).toContain("set a value to see this");
  });
});
