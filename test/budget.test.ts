import { describe, it, expect } from "vitest";
import { writeBudget, writeProposalValue, budgetVariance } from "@/lib/pipeline/budget";
import { budgetScore } from "@/lib/scoring";
import { priorityOf } from "@/lib/priority";
import type { Brand } from "@/lib/types";

/** Accepting an offer is the proposal path at full confidence. */
const confirmBudget = (b: Brand, value: number) => writeProposalValue(b, value, "Confirmed");

const lead = (over: Partial<Brand> = {}, budget: number | null = 40_000): Brand => ({
  id: "l1", name: "L", aliases: [], status: "Shape proposal", priority: null,
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

  it("confirms against a lead that was never scored", () => {
    // A lead added through the UI has no score record. Bailing out here meant
    // an accepted six-figure offer left the company reporting €0 lifetime
    // value, which is what the platform actually did.
    const unscored = lead({ scored: false, scores: undefined });
    const after = confirmBudget(unscored, 52_000);
    expect(after.scores!.budget).toBe(52_000);
    expect(after.scores!.assumption).toBe("Confirmed");
    expect(after.scored).toBe(true);
    // No estimate was ever made, so there is nothing to compare against.
    expect(after.budgetAtOpen).toBeNull();
    expect(budgetVariance(after)).toBeNull();
  });

  it("keeps a missing original estimate missing when a second offer lands", () => {
    const first = confirmBudget(lead({ scored: false, scores: undefined }), 52_000);
    expect(confirmBudget(first, 61_000).budgetAtOpen).toBeNull();
  });

  it("handles a free project being accepted at zero", () => {
    const after = confirmBudget(lead({}, 0), 0);
    expect(after.scores!.assumption).toBe("Confirmed");
    expect(after.budgetAtOpen).toBe(0);
  });
});

describe("writeBudget", () => {
  it("creates a score record for a lead that has none", () => {
    const after = writeBudget(lead({ scored: false, scores: undefined, industry: "Finance" }), 45_000, "Estimated");
    expect(after.scores!.budget).toBe(45_000);
    expect(after.scores!.industry).toBe("Finance");
    expect(after.scored).toBe(true);
    // Nothing else has been judged, so nothing else is claimed.
    expect(after.scores!.customizationScore).toBeNull();
    expect(after.scores!.accessibilityScore).toBeNull();
  });

  it("makes the lead rankable, which is the point of asking for a value", () => {
    const after = writeBudget(lead({ scored: false, scores: undefined }), 45_000, "Estimated");
    expect(priorityOf(after)).not.toBeNull();
  });

  it("records no value as no value rather than inventing a record", () => {
    const unscored = lead({ scored: false, scores: undefined });
    expect(writeBudget(unscored, null, null)).toBe(unscored);
  });

  it("clears a value on a lead that already has one", () => {
    const after = writeBudget(lead(), null, null);
    expect(after.scores!.budget).toBeNull();
    expect(after.scores!.budgetScore).toBeNull();
  });

  it("returns the same object when nothing changes", () => {
    const l = lead();
    expect(writeBudget(l, 40_000, "Estimated")).toBe(l);
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
