import { STAGE_PROBABILITY } from "./scoring";
import { monthsBetween } from "./time";
import type { Brand, BrandStatus } from "./types";

/**
 * Priority — the two-axis replacement for the single averaged lead score.
 *
 * The old score averaged six 0–5 rubric numbers, which made budget worth
 * 0.55/3 = 18.3% of the result: €80,000 of revenue counted for about six
 * points of brand-message alignment, and a €0 project could average its way to
 * third place. Averaging also let a strong axis paper over a fatal one.
 *
 * So the axes are kept apart and only the two that genuinely compose are
 * blended:
 *
 *   OI  what is this worth       money, plus capped strategic value
 *   WI  will it actually close   stage, freshness, reachability, receptivity
 *   EI  what will it cost to run — reported, deliberately NEVER blended
 *
 * `priority = round(sqrt(OI * WI))` — a geometric mean, so weakness on one
 * axis cannot be averaged away by strength on the other. A zero opportunity is
 * fatal outright, which is precisely the €0 case. Winnability cannot reach
 * zero, because its recency term is floored at a quarter — so an unwinnable
 * deal bottoms out near 6 and crushes the priority rather than nulling it,
 * which is right: a large deal going nowhere is still worth a glance.
 *
 * Pure and time-injectable so every branch is testable.
 */

/** Above this the money axis stops growing; the sheet's own budget ceiling. */
export const BUDGET_CEILING = 80_000;

/**
 * How much of a stated budget to believe. An accepted proposal makes it
 * Confirmed (see pipeline/budget), so this rewards evidence, not optimism.
 */
export const CONFIDENCE: Record<"Confirmed" | "Estimated" | "unstated", number> = {
  Confirmed: 1.0,
  Estimated: 0.6,
  unstated: 0.4,
};

/** Halves every six months of silence, never below a quarter. */
export const RECENCY_HALF_LIFE_MONTHS = 6;
export const RECENCY_FLOOR = 0.25;

/** Normalising WI's stage term by the strongest *open* stage puts it on 0–1. */
const OPEN_STAGE_MAX = STAGE_PROBABILITY.Recurring;

export const PURSUE_OI = 35;
export const PURSUE_WI = 45;

/** Why a deal is worth more than its invoice. Chosen from a list, so it cannot be argued into anything. */
export const STRATEGIC_REASONS = [
  "Logo we can name",
  "Referral source",
  "Reference case",
  "Market entry",
  "Portfolio showcase",
  "Partner access",
] as const;
export type StrategicReason = (typeof STRATEGIC_REASONS)[number];

export type Grade = "A" | "B" | "C" | "D";
export type PriorityQuadrant = "Pursue" | "Invest" | "Quick win" | "Park";

export interface PriorityBreakdown {
  /** Budget after discounting for how much evidence backs it. */
  adjustedBudget: number;
  moneyIndex: number;
  strategicIndex: number;
  opportunity: number;
  winProbability: number;
  recency: number;
  winnability: number;
  ease: number;
  priority: number;
  grade: Grade;
  quadrant: PriorityQuadrant;
  /** Candidate A's number: shown beside priority, never folded into it. */
  expectedValueEur: number;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function confidenceFor(assumption: "Confirmed" | "Estimated" | null | undefined): number {
  return assumption ? CONFIDENCE[assumption] : CONFIDENCE.unstated;
}

/**
 * Months of silence, decayed. Falls back to first contact because a lead can
 * be real without anyone having logged a follow-up yet; with neither date the
 * record shows nobody working it, and the floor says so.
 */
export function recencyOf(brand: Pick<Brand, "lastContact" | "initialContact">, now: Date = new Date()): number {
  const since = brand.lastContact ?? brand.initialContact;
  if (!since) return RECENCY_FLOOR;
  const months = monthsBetween(since, now.toISOString().slice(0, 10));
  if (months == null) return RECENCY_FLOOR; // a date in the future tells us nothing
  return Math.max(RECENCY_FLOOR, 0.5 ** (months / RECENCY_HALF_LIFE_MONTHS));
}

export function gradeFor(priority: number): Grade {
  if (priority >= 65) return "A";
  if (priority >= 45) return "B";
  if (priority >= 25) return "C";
  return "D";
}

export function quadrantFor(opportunity: number, winnability: number): PriorityQuadrant {
  if (opportunity >= PURSUE_OI) return winnability >= PURSUE_WI ? "Pursue" : "Invest";
  return winnability >= PURSUE_WI ? "Quick win" : "Park";
}

/** Null when the lead has never been scored — there is nothing to rank. */
export function priorityOf(brand: Brand, now: Date = new Date()): PriorityBreakdown | null {
  const s = brand.scores;
  if (!s) return null;

  const adjustedBudget = (s.budget ?? 0) * confidenceFor(s.assumption);
  const moneyIndex = 100 * clamp01(adjustedBudget / BUDGET_CEILING);
  const strategicIndex = 100 * clamp01((brand.strategicValue ?? 0) / 3);
  // Strategic value is capped at a quarter of the axis so a flagship freebie
  // stays visible without being able to outrank paid work on its own.
  const opportunity = Math.min(100, 0.75 * moneyIndex + 0.25 * strategicIndex);

  const pWin = STAGE_PROBABILITY[brand.status as BrandStatus] ?? 0;
  const recency = recencyOf(brand, now);
  const winnability =
    100 *
    clamp01(
      0.45 * clamp01(pWin / OPEN_STAGE_MAX) +
        0.25 * recency +
        0.15 * clamp01((s.accessibilityScore ?? 0) / 5) +
        0.15 * clamp01((s.receptivityScore ?? 0) / 5),
    );

  const ease =
    (100 *
      ((s.customizationScore ?? 0) +
        (s.accessibilityScore ?? 0) +
        (s.receptivityScore ?? 0) +
        (s.alignmentScore ?? 0))) /
    20;

  const priority = Math.round(Math.sqrt(opportunity * winnability));

  return {
    adjustedBudget,
    moneyIndex,
    strategicIndex,
    opportunity,
    winProbability: pWin,
    recency,
    winnability,
    ease,
    priority,
    grade: gradeFor(priority),
    quadrant: quadrantFor(opportunity, winnability),
    expectedValueEur: adjustedBudget * pWin * recency,
  };
}

/** Ranked highest-priority first, with ease breaking ties inside a quadrant. */
export function rankByPriority<T extends Brand>(brands: T[], now: Date = new Date()): { brand: T; p: PriorityBreakdown }[] {
  return brands
    .map((brand) => ({ brand, p: priorityOf(brand, now) }))
    .filter((r): r is { brand: T; p: PriorityBreakdown } => r.p !== null)
    .sort((a, b) => b.p.priority - a.p.priority || b.p.ease - a.p.ease || a.brand.name.localeCompare(b.brand.name));
}
