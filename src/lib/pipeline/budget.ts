import { budgetScore, economicalEfficiency } from "@/lib/scoring";
import type { Brand, BrandScores } from "@/lib/types";

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
  return writeBudget(brand, acceptedValue, "Confirmed");
}

/**
 * A score record for a lead nobody has run through the rubric.
 *
 * Every judgement is null because none has been made; only the industry is
 * known, and it is copied rather than guessed.
 */
function blankScores(brand: Brand): BrandScores {
  return {
    tempoMonths: null,
    tempoScore: null,
    closing: null,
    process: null,
    dealsClosed: null,
    budget: null,
    assumption: null,
    budgetScore: null,
    customizationScore: null,
    accessibilityRaw: null,
    accessibilityScore: null,
    receptivityScore: null,
    alignmentScore: null,
    industry: brand.industry ?? "Other",
    economicalEfficiency: null,
    easeOfAccess: null,
  };
}

/**
 * Write a commercial value onto a lead, creating the score record if the lead
 * has never had one.
 *
 * A lead added through the UI arrives with no `scores` at all, so the previous
 * `if (!s) return brand` meant accepting a proposal against it silently did
 * nothing: the company kept reporting €0 lifetime value next to an accepted
 * six-figure offer. Recording the figure is what makes a lead rankable, so the
 * lead counts as scored from here on.
 */
export function writeBudget(
  brand: Brand,
  value: number | null,
  assumption: "Confirmed" | "Estimated" | null,
): Brand {
  const s = brand.scores;
  if (!s && value == null) return brand; // nothing said, nothing to record
  if (s && s.budget === value && s.assumption === assumption) return brand;

  const base = s ?? blankScores(brand);
  const scores: BrandScores = {
    ...base,
    budget: value,
    assumption,
    budgetScore: value == null ? null : budgetScore(value),
  };
  scores.economicalEfficiency = economicalEfficiency(scores) ?? base.economicalEfficiency;

  return {
    ...brand,
    scored: brand.scored || value != null,
    // Captured once: a second accepted offer must not overwrite the original
    // hypothesis with the previous actual. `??` cannot be used here — a lead
    // that opened with no estimate records null, and null is an answer.
    budgetAtOpen: brand.budgetAtOpen === undefined ? base.budget : brand.budgetAtOpen,
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
