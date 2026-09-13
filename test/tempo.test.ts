import { describe, it, expect } from "vitest";
import dataset from "@/data/dataset.json";
import { effectiveScores, effectiveTempoMonths, leadScore, tempoScore } from "@/lib/scoring";
import { monthsBetween } from "@/lib/time";
import { outcomeOf } from "@/lib/lifecycle";
import type { Brand } from "@/lib/types";

const brands = (dataset as unknown as { brands: Brand[] }).brands;

const lead = (over: Partial<Brand> = {}): Brand => ({
  id: "l1", name: "L", aliases: [], status: "Qualify lead", priority: null,
  owner: null, poc: null, email: null, industry: null, industryRaw: null,
  initialContact: null, lastContact: null, followUpDate: null, closingFailed: null,
  notes: null, scored: false,
  ...over,
});

const scored = (over: Partial<Brand> = {}, scores: Partial<NonNullable<Brand["scores"]>> = {}): Brand =>
  lead({
    scored: true,
    scores: {
      tempoMonths: 4, tempoScore: tempoScore(4), closing: null, process: null, dealsClosed: null,
      budget: 40_000, assumption: "Estimated", budgetScore: 2.5, customizationScore: 3,
      accessibilityRaw: null, accessibilityScore: 3, receptivityScore: 3, alignmentScore: 3,
      industry: "Other", economicalEfficiency: null, easeOfAccess: 3,
      ...scores,
    },
    ...over,
  });

describe("monthsBetween", () => {
  it("measures a forward span", () => {
    expect(monthsBetween("2026-01-01", "2026-07-01")!).toBeCloseTo(5.98, 1);
  });

  it("refuses a backwards span rather than returning a negative", () => {
    // The sheet really contains one of these (mk2 closes 11 months before it
    // opens). Passed through the tempo formula a negative clamps to a PERFECT
    // score, so a typo would look like the fastest deal we ever ran.
    expect(monthsBetween("2026-10-25", "2025-11-14")).toBeNull();
  });

  it("returns zero for a same-day close, not null", () => {
    expect(monthsBetween("2026-05-01", "2026-05-01")).toBe(0);
  });

  it("returns null when a date is missing or unparseable", () => {
    expect(monthsBetween(null, "2026-05-01")).toBeNull();
    expect(monthsBetween("2026-05-01", null)).toBeNull();
    expect(monthsBetween("nonsense", "2026-05-01")).toBeNull();
    expect(monthsBetween("2026-05-01", "nonsense")).toBeNull();
  });
});

describe("effectiveTempoMonths", () => {
  it("uses the estimate while the deal is open", () => {
    const b = scored({ expectedMonths: 8, initialContact: "2026-01-01" });
    expect(effectiveTempoMonths(b)).toEqual({ months: 8, basis: "expected" });
  });

  it("prefers a human estimate over the sheet's number", () => {
    const b = scored({ expectedMonths: 8 }, { tempoMonths: 1 });
    expect(effectiveTempoMonths(b).months).toBe(8);
  });

  it("falls back to the sheet so an un-reestimated lead keeps today's number", () => {
    expect(effectiveTempoMonths(scored()).months).toBe(4);
  });

  it("switches to measured time once the deal closes", () => {
    const b = scored({
      status: "Closed deal", expectedMonths: 8,
      initialContact: "2026-01-01", closingFailed: "2026-03-01",
    });
    const t = effectiveTempoMonths(b);
    expect(t.basis).toBe("actual");
    expect(t.months!).toBeCloseTo(1.97, 1);
  });

  it("keeps the estimate when a closed deal has no close date", () => {
    const b = scored({ status: "Closed deal", expectedMonths: 8, initialContact: "2026-01-01" });
    expect(effectiveTempoMonths(b)).toEqual({ months: 8, basis: "expected" });
  });

  it("keeps the estimate rather than trusting a backwards close date", () => {
    const b = scored({
      status: "Closed deal", expectedMonths: 8,
      initialContact: "2026-10-25", closingFailed: "2025-11-14",
    });
    expect(effectiveTempoMonths(b)).toEqual({ months: 8, basis: "expected" });
  });

  it("reports nothing when there is no estimate anywhere", () => {
    expect(effectiveTempoMonths(lead())).toEqual({ months: null, basis: "none" });
  });
});

describe("effectiveScores", () => {
  it("returns the same object when nothing has changed", () => {
    // Identity matters: it is what makes this safe to call on every render.
    const b = scored();
    expect(effectiveScores(b)).toBe(b.scores);
  });

  it("recomputes tempo and economical efficiency from a new estimate", () => {
    const b = scored({ expectedMonths: 8 });
    const s = effectiveScores(b)!;
    expect(s.tempoMonths).toBe(8);
    expect(s.tempoScore).toBe(tempoScore(8));
    // mean(budgetScore, customizationScore, tempoScore)
    expect(s.economicalEfficiency).toBeCloseTo((2.5 + 3 + tempoScore(8)) / 3, 6);
  });

  it("leaves ease of access alone - tempo only feeds the economic axis", () => {
    const s = effectiveScores(scored({ expectedMonths: 8 }))!;
    expect(s.easeOfAccess).toBe(3);
  });

  it("has nothing to say about an unscored lead", () => {
    expect(effectiveScores(lead())).toBeUndefined();
  });

  it("moves the lead score with the estimate", () => {
    const slow = leadScore(scored({ expectedMonths: 8 }))!;
    const fast = leadScore(scored({ expectedMonths: 1 }))!;
    expect(fast).toBeGreaterThan(slow);
  });
});

// ---------------------------------------------------------------------------
// The safety argument, checked against the real sheet rather than asserted
// ---------------------------------------------------------------------------

describe("against the real dataset", () => {
  it("does not move a single open lead's score", () => {
    // Ranked lists only ever show open leads, so this is what guarantees the
    // change reorders nothing. It holds because the sheet's tempoScore is
    // exactly tempoScore(tempoMonths) for all 45 scored rows.
    const moved = brands
      .filter((b) => outcomeOf(b.status) === "open" && b.scored)
      .filter((b) => effectiveScores(b) !== b.scores);
    expect(moved.map((b) => b.id)).toEqual([]);
  });

  it("gives closed deals their measured duration instead of the estimate", () => {
    const closedWithDates = brands.filter(
      (b) => outcomeOf(b.status) !== "open" && b.scored && monthsBetween(b.initialContact, b.closingFailed) != null,
    );
    expect(closedWithDates.length).toBeGreaterThan(0);
    for (const b of closedWithDates) {
      expect(effectiveTempoMonths(b).basis, b.id).toBe("actual");
    }
  });

  it("still refuses the one row whose close date precedes its open date", () => {
    const mk2 = brands.find((b) => b.id === "mk2");
    expect(mk2, "mk2 is the known backwards-date row").toBeDefined();
    expect(effectiveTempoMonths(mk2!).basis).toBe("expected");
  });
});
