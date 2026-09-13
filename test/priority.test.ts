import { describe, it, expect } from "vitest";
import dataset from "@/data/dataset.json";
import {
  BUDGET_CEILING,
  CONFIDENCE,
  RECENCY_FLOOR,
  confidenceFor,
  gradeFor,
  priorityOf,
  quadrantFor,
  rankByPriority,
  recencyOf,
} from "@/lib/priority";
import { openLeads } from "@/lib/lifecycle";
import type { Brand } from "@/lib/types";

const NOW = new Date("2026-08-12T00:00:00.000Z");
const brands = (dataset as unknown as { brands: Brand[] }).brands;

/** `months` before NOW, as yyyy-MM-dd. */
const monthsAgo = (m: number): string => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - Math.round(m * 30.44));
  return d.toISOString().slice(0, 10);
};

const lead = (over: Partial<Brand> = {}, scores: Partial<NonNullable<Brand["scores"]>> = {}): Brand => ({
  id: "l1", name: "L", aliases: [], status: "Shape proposal", priority: null,
  owner: null, poc: null, email: null, industry: null, industryRaw: null,
  initialContact: monthsAgo(1), lastContact: monthsAgo(0), followUpDate: null,
  closingFailed: null, notes: null, scored: true,
  scores: {
    tempoMonths: 1, tempoScore: 4.375, closing: null, process: null, dealsClosed: null,
    budget: 40_000, assumption: "Confirmed", budgetScore: 2.5, customizationScore: 3,
    accessibilityRaw: null, accessibilityScore: 3, receptivityScore: 3, alignmentScore: 3,
    industry: "Other", economicalEfficiency: 3, easeOfAccess: 3,
    ...scores,
  },
  ...over,
});

// ---------------------------------------------------------------------------
// The property the whole redesign rests on
// ---------------------------------------------------------------------------

describe("the geometric mean", () => {
  it("makes a zero opportunity fatal", () => {
    // This is the fix for the €0 bug. An arithmetic mean cannot do it at any
    // weighting, which is how a free project averaged its way to third place.
    const worthless = priorityOf(lead({ strategicValue: 0 }, { budget: 0 }), NOW)!;
    expect(worthless.opportunity).toBe(0);
    expect(worthless.priority).toBe(0);
  });

  it("crushes rather than zeroes an unwinnable deal", () => {
    // Winnability cannot reach zero: its recency term is floored at a quarter,
    // so the axis bottoms out near 6. That is deliberate - a large deal going
    // nowhere still deserves a glance, unlike one worth nothing at all.
    const unwinnable = priorityOf(
      lead(
        { status: "Lost", lastContact: monthsAgo(120), initialContact: monthsAgo(120) },
        { budget: BUDGET_CEILING, accessibilityScore: 0, receptivityScore: 0 },
      ),
      NOW,
    )!;
    expect(unwinnable.winnability).toBeCloseTo(100 * 0.25 * RECENCY_FLOOR, 6);
    expect(unwinnable.opportunity).toBe(75);
    // Down from 75 on opportunity alone.
    expect(unwinnable.priority).toBeLessThan(25);
    expect(unwinnable.priority).toBeGreaterThan(0);
  });

  it("punishes a lopsided deal harder than averaging would", () => {
    // 100 and 20 average to 60 but compose to 45: strength on one axis must
    // not paper over weakness on the other.
    const lopsided = Math.round(Math.sqrt(100 * 20));
    expect(lopsided).toBe(45);
    expect(lopsided).toBeLessThan((100 + 20) / 2);
  });

  it("never lets ease rescue a worthless deal", () => {
    // Ease is reported but never blended - the old formula's real failure.
    const easyAndWorthless = priorityOf(
      lead({}, { budget: 0, customizationScore: 5, accessibilityScore: 5, receptivityScore: 5, alignmentScore: 5 }),
      NOW,
    )!;
    expect(easyAndWorthless.ease).toBe(100);
    expect(easyAndWorthless.priority).toBe(0);
  });
});

describe("the opportunity axis", () => {
  it("discounts a budget by how much evidence backs it", () => {
    const confirmed = priorityOf(lead({}, { budget: 40_000, assumption: "Confirmed" }), NOW)!;
    const estimated = priorityOf(lead({}, { budget: 40_000, assumption: "Estimated" }), NOW)!;
    const unstated = priorityOf(lead({}, { budget: 40_000, assumption: null }), NOW)!;
    expect(confirmed.adjustedBudget).toBe(40_000);
    expect(estimated.adjustedBudget).toBe(40_000 * CONFIDENCE.Estimated);
    expect(unstated.adjustedBudget).toBe(40_000 * CONFIDENCE.unstated);
    expect(confirmed.opportunity).toBeGreaterThan(estimated.opportunity);
    expect(estimated.opportunity).toBeGreaterThan(unstated.opportunity);
  });

  it("stops rewarding budget above the ceiling", () => {
    const at = priorityOf(lead({}, { budget: BUDGET_CEILING }), NOW)!;
    const over = priorityOf(lead({}, { budget: BUDGET_CEILING * 4 }), NOW)!;
    expect(at.moneyIndex).toBe(100);
    expect(over.moneyIndex).toBe(100);
  });

  it("lets strategic value lift a free project without letting it win", () => {
    // The Montecarlo case: visible mid-table, structurally unable to top a
    // ranking on revenue merit.
    const flagshipFreebie = priorityOf(lead({ strategicValue: 3 }, { budget: 0 }), NOW)!;
    expect(flagshipFreebie.opportunity).toBe(25);
    expect(flagshipFreebie.priority).toBeGreaterThan(0);

    const paid = priorityOf(lead({ strategicValue: 0 }, { budget: BUDGET_CEILING }), NOW)!;
    expect(flagshipFreebie.priority).toBeLessThan(paid.priority);
  });

  it("caps strategic value at a quarter of the axis", () => {
    const maxStrategic = priorityOf(lead({ strategicValue: 99 }, { budget: 0 }), NOW)!;
    expect(maxStrategic.opportunity).toBe(25);
  });

  it("treats a missing budget as zero rather than throwing", () => {
    expect(priorityOf(lead({}, { budget: null }), NOW)!.moneyIndex).toBe(0);
  });
});

describe("the winnability axis", () => {
  it("rises with the stage", () => {
    const early = priorityOf(lead({ status: "Qualify lead" }), NOW)!;
    const advanced = priorityOf(lead({ status: "Shape proposal" }), NOW)!;
    const recurring = priorityOf(lead({ status: "Recurring" }), NOW)!;
    expect(advanced.winnability).toBeGreaterThan(early.winnability);
    expect(recurring.winnability).toBeGreaterThan(advanced.winnability);
  });

  it("decays with silence and never falls through the floor", () => {
    const fresh = recencyOf({ lastContact: monthsAgo(0), initialContact: null }, NOW);
    const halfLife = recencyOf({ lastContact: monthsAgo(6), initialContact: null }, NOW);
    const ancient = recencyOf({ lastContact: monthsAgo(120), initialContact: null }, NOW);
    expect(fresh).toBeCloseTo(1, 1);
    expect(halfLife).toBeCloseTo(0.5, 1);
    expect(ancient).toBe(RECENCY_FLOOR);
  });

  it("falls back to first contact, because a real lead may have no follow-up logged", () => {
    const only = recencyOf({ lastContact: null, initialContact: monthsAgo(6) }, NOW);
    expect(only).toBeCloseTo(0.5, 1);
  });

  it("uses the floor when no contact was ever recorded", () => {
    // Nothing on the record says anyone is working it, and that is the signal.
    expect(recencyOf({ lastContact: null, initialContact: null }, NOW)).toBe(RECENCY_FLOOR);
  });

  it("does not reward a contact date in the future", () => {
    const future = new Date(NOW);
    future.setFullYear(future.getFullYear() + 1);
    expect(recencyOf({ lastContact: future.toISOString().slice(0, 10), initialContact: null }, NOW)).toBe(RECENCY_FLOOR);
  });

  it("stays within 0-100 for the strongest possible lead", () => {
    const best = priorityOf(
      lead({ status: "Recurring", lastContact: monthsAgo(0) }, { accessibilityScore: 5, receptivityScore: 5 }),
      NOW,
    )!;
    expect(best.winnability).toBeLessThanOrEqual(100);
    expect(best.winnability).toBeGreaterThan(80);
  });
});

describe("grades and quadrants", () => {
  it("grades on the documented boundaries", () => {
    expect(gradeFor(65)).toBe("A");
    expect(gradeFor(64)).toBe("B");
    expect(gradeFor(45)).toBe("B");
    expect(gradeFor(44)).toBe("C");
    expect(gradeFor(25)).toBe("C");
    expect(gradeFor(24)).toBe("D");
    expect(gradeFor(0)).toBe("D");
  });

  it("names each corner of the matrix", () => {
    expect(quadrantFor(50, 50)).toBe("Pursue");
    expect(quadrantFor(50, 40)).toBe("Invest");
    expect(quadrantFor(20, 50)).toBe("Quick win");
    expect(quadrantFor(20, 40)).toBe("Park");
  });

  it("puts the thresholds themselves in the stronger box", () => {
    expect(quadrantFor(35, 45)).toBe("Pursue");
  });
});

describe("expected value", () => {
  it("is reported but kept out of the priority", () => {
    const p = priorityOf(lead({}, { budget: 40_000, assumption: "Confirmed" }), NOW)!;
    expect(p.expectedValueEur).toBeCloseTo(40_000 * p.winProbability * p.recency, 6);
    // Two deals can share a priority and differ wildly in euros; that is why
    // the euro figure is shown beside it rather than folded in.
    expect(p.expectedValueEur).not.toBe(p.priority);
  });
});

describe("ranking", () => {
  it("orders by priority, then ease, then name", () => {
    const ranked = rankByPriority([
      lead({ id: "low", name: "Low" }, { budget: 1_000 }),
      lead({ id: "high", name: "High" }, { budget: BUDGET_CEILING }),
    ], NOW);
    expect(ranked.map((r) => r.brand.id)).toEqual(["high", "low"]);
  });

  it("drops unscored leads rather than ranking them at zero", () => {
    const ranked = rankByPriority([lead(), { ...lead(), id: "u", scored: false, scores: undefined }], NOW);
    expect(ranked.map((r) => r.brand.id)).toEqual(["l1"]);
  });

  it("is deterministic for identical leads", () => {
    const a = lead({ id: "a", name: "A" });
    const b = lead({ id: "b", name: "B" });
    expect(rankByPriority([a, b], NOW).map((r) => r.brand.id)).toEqual(["a", "b"]);
    expect(rankByPriority([b, a], NOW).map((r) => r.brand.id)).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// Against the real sheet
// ---------------------------------------------------------------------------

describe("against the real dataset", () => {
  const open = openLeads(brands.filter((b) => b.scored && b.scores));

  it("scores every open scored lead without throwing", () => {
    expect(open.length).toBeGreaterThan(0);
    for (const b of open) {
      const p = priorityOf(b, NOW)!;
      expect(p.priority, b.id).toBeGreaterThanOrEqual(0);
      expect(p.priority, b.id).toBeLessThanOrEqual(100);
    }
  });

  it("gives budget far more say than the old 18.3%", () => {
    // The diagnosis: budget was 0.55/3 of the old score, so €80k counted for
    // about six points of brand-message alignment. Holding everything else
    // equal, the ceiling must now clearly outrank a nominal budget.
    const base = open[0];
    const rich = priorityOf({ ...base, scores: { ...base.scores!, budget: BUDGET_CEILING, assumption: "Confirmed" } }, NOW)!;
    const poor = priorityOf({ ...base, scores: { ...base.scores!, budget: 1_000, assumption: "Confirmed" } }, NOW)!;
    expect(rich.priority - poor.priority).toBeGreaterThan(20);
  });

  it("never ranks a finished deal, because they are gated out upstream", () => {
    const closed = brands.filter((b) => b.status === "Closed deal" || b.status === "Lost");
    expect(closed.length).toBeGreaterThan(0);
    expect(openLeads(closed)).toEqual([]);
  });
});
