import { describe, it, expect } from "vitest";
import { confirmBudget, budgetVariance } from "@/lib/pipeline/budget";
import { budgetScore } from "@/lib/scoring";
import type { Brand } from "@/lib/types";

const lead = (over: Partial<Brand> = {}, budget: number | null = 40_000): Brand => ({
  id: "l1", name: "L", aliases: [], status: "Advanced", priority: null,
  owner: null, poc: null, email: null, industry: null, industryRaw: null,
  initialContact: null, lastContact: null, followUpDate: null, closingFailed: null,
  notes: null, scored: true,
  scores: {
    tempoMonths: 4, tempoScore: 2.5, closing: null, process: null, dealsClosed: null,
    budget, assumption: "Estimated", budgetScore: budget == null ? null : budgetScore(budget),
    customizationScore: 3, accessibilityRaw: null, accessibilityScore: 3,
    receptivityScore: 3, alignmentScore: 3, industry: "Other",
    economicalEfficiency: null, easeOfAccess: 3,
  },
  ...over,
});

describe("confirmBudget", () => {
  it("replaces the guess with the accepted offer and marks it confirmed", () => {
    const after = confirmBudget(lead(), 52_000);
    expect(after.scores!.budget).toBe(52_000);
    expect(after.scores!.assumption).toBe("Confirmed");
    expect(after.scores!.budgetScore).toBe(budgetScore(52_000));
  });

  it("keeps the original estimate so the comparison survives", () => {
    expect(confirmBudget(lead(), 52_000).budgetAtOpen).toBe(40_000);
  });

  it("does not let a second acceptance overwrite the original estimate", () => {
    // Otherwise the "hypothesis" slowly becomes the previous actual and the
    // variance quietly converges on zero.
    const first = confirmBudget(lead(), 52_000);
    const second = confirmBudget(first, 61_000);
    expect(second.budgetAtOpen).toBe(40_000);
    expect(second.scores!.budget).toBe(61_000);
  });

  it("recomputes economical efficiency from the confirmed number", () => {
    const after = confirmBudget(lead(), 80_000);
    const s = after.scores!;
    expect(s.economicalEfficiency).toBeCloseTo((s.budgetScore! + 3 + 2.5) / 3, 6);
  });

  it("returns the same object when there is nothing to change", () => {
    const already = confirmBudget(lead(), 52_000);
    expect(confirmBudget(already, 52_000)).toBe(already);
  });

  it("leaves an unscored lead alone rather than inventing scores", () => {
    const unscored = lead({ scored: false, scores: undefined });
    expect(confirmBudget(unscored, 52_000)).toBe(unscored);
  });

  it("handles a free project being accepted at zero", () => {
    const after = confirmBudget(lead({}, 0), 0);
    expect(after.scores!.assumption).toBe("Confirmed");
    expect(after.budgetAtOpen).toBe(0);
  });
});

describe("budgetVariance", () => {
  it("reports the gap between guess and reality", () => {
    const v = budgetVariance(confirmBudget(lead(), 52_000))!;
    expect(v).toMatchObject({ estimated: 40_000, actual: 52_000, deltaEur: 12_000 });
    expect(v.deltaPct).toBeCloseTo(30, 6);
  });

  it("reports a shortfall as a negative", () => {
    const v = budgetVariance(confirmBudget(lead(), 30_000))!;
    expect(v.deltaEur).toBe(-10_000);
    expect(v.deltaPct).toBeCloseTo(-25, 6);
  });

  it("has nothing to say before an offer is accepted", () => {
    expect(budgetVariance(lead())).toBeNull();
  });

  it("gives no percentage against a zero estimate rather than infinity", () => {
    const v = budgetVariance(confirmBudget(lead({}, 0), 15_000))!;
    expect(v.deltaEur).toBe(15_000);
    expect(v.deltaPct).toBeNull();
  });
});
