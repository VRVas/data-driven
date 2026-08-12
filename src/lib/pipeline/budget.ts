import { budgetScore, economicalEfficiency } from "@/lib/scoring";
import type { Brand } from "@/lib/types";

/**
 * Estimated budget versus the offer that was actually accepted.
 *
 * The ask was to treat the number typed when a lead opens as a hypothesis and
 * replace it with fact once an offer is accepted. An accepted proposal *is*
 * that fact, so it is written onto the lead rather than derived on every read:
 * the budget feeds the score, and a figure that changes depending on whether
 * the caller happened to load proposals is how one lead ends up with two
 * different scores on two pages.
 *
 * The original estimate is kept so the comparison survives the overwrite.
 */

export interface BudgetVariance {
  estimated: number;
  actual: number;
  deltaEur: number;
  /** Null when the estimate was zero — a free project has no percentage. */
  deltaPct: number | null;
}

/**
 * Record an accepted offer as the lead's confirmed budget.
 *
 * Returns the same object when there is nothing to change, so callers can save
 * unconditionally without writing a no-op record.
 */
export function confirmBudget(brand: Brand, acceptedValue: number): Brand {
  const s = brand.scores;
  if (!s) return brand; // an unscored lead has no budget to confirm
  if (s.budget === acceptedValue && s.assumption === "Confirmed") return brand;

  const scores = {
    ...s,
    budget: acceptedValue,
    assumption: "Confirmed" as const,
    budgetScore: budgetScore(acceptedValue),
  };
  scores.economicalEfficiency = economicalEfficiency(scores) ?? s.economicalEfficiency;

  return {
    ...brand,
    // Captured once: a second accepted offer must not overwrite the original
    // hypothesis with the previous actual.
    budgetAtOpen: brand.budgetAtOpen ?? s.budget,
    scores,
  };
}

/** What we guessed against what we got, once an offer has been accepted. */
export function budgetVariance(brand: Brand): BudgetVariance | null {
  const estimated = brand.budgetAtOpen;
  const actual = brand.scores?.budget;
  if (estimated == null || actual == null) return null;

  const deltaEur = actual - estimated;
  return {
    estimated,
    actual,
    deltaEur,
    deltaPct: estimated === 0 ? null : (deltaEur / estimated) * 100,
  };
}
