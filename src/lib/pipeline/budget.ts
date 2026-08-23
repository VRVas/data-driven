import { budgetScore, economicalEfficiency } from "@/lib/scoring";
import { blankScores } from "./rubric";
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
  /** Null when the estimate was zero - a free project has no percentage. */
  deltaPct: number | null;
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

  return { ...brand, scored: brand.scored || value != null, scores };
}

/**
 * Write the value a proposal asserts, remembering the figure it replaced.
 *
 * `budgetAtOpen` is captured here and nowhere else, because it means "what we
 * thought before the paperwork said otherwise". Capturing it on an ordinary
 * edit would freeze it the moment a lead was created - at null, since a new
 * lead has no previous budget - and the estimate-versus-accepted comparison
 * would report nothing for every lead made in the app.
 *
 * `undefined` means never captured; null means captured and there was no
 * estimate. The difference is what stops a second proposal from recording the
 * first proposal's number as the original guess.
 */
export function writeProposalValue(
  brand: Brand,
  value: number,
  assumption: "Confirmed" | "Estimated",
): Brand {
  const next = writeBudget(brand, value, assumption);
  if (next === brand) return brand;

  return {
    ...next,
    budgetAtOpen: brand.budgetAtOpen === undefined ? (brand.scores?.budget ?? null) : brand.budgetAtOpen,
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
