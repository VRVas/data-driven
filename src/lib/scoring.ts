import type { Brand, BrandScores, BrandStatus, Priority, Valuation } from "./types";
import { outcomeOf } from "./lifecycle";
import { monthsBetween } from "./time";

/* ------------------------------------------------------------------ */
/*  Scoring model — reverse-engineered from the workbook's formulas    */
/*  and rubric comments, re-implemented so the platform (not Excel)    */
/*  is the source of truth.                                            */
/* ------------------------------------------------------------------ */

const clamp = (n: number, lo = 0, hi = 5) => Math.max(lo, Math.min(hi, n));

/** Freshness: fewer months since contact -> higher score. `=(10-(m*10/8))/2` */
export function tempoScore(months: number): number {
  return clamp((10 - (months * 10) / 8) / 2);
}

/** Budget 0–80k€ mapped to 0–5 (1–16k => 0.5, cap at 80k => 5). */
export function budgetScore(budget: number): number {
  const raw = budget >= 1 && budget <= 15999 ? 1 : (10 * budget) / 80000;
  return clamp(raw / 2);
}

export function economicalEfficiency(s: {
  budgetScore: number | null;
  customizationScore: number | null;
  tempoScore: number | null;
}): number | null {
  const v = [s.budgetScore, s.customizationScore, s.tempoScore];
  return v.every((x) => x != null) ? (v as number[]).reduce((a, b) => a + b, 0) / 3 : null;
}

export function easeOfAccess(s: {
  accessibilityScore: number | null;
  alignmentScore: number | null;
  receptivityScore: number | null;
}): number | null {
  const v = [s.accessibilityScore, s.alignmentScore, s.receptivityScore];
  return v.every((x) => x != null) ? (v as number[]).reduce((a, b) => a + b, 0) / 3 : null;
}

/**
 * How long the deal takes — estimated while it runs, measured once it ends.
 *
 * Tempo used to mean "months since last contact", which conflated how long a
 * deal takes with how long we have ignored it. It now means duration: the
 * estimate someone made when the lead opened ("a slow enterprise, call it
 * eight months"), replaced by the real elapsed time once the deal closes.
 * Going cold is a separate signal and lives in pipeline/health.
 *
 * The sheet's own `tempoMonths` is the fallback estimate, so a lead nobody has
 * re-estimated keeps exactly the number it has today.
 */
export function effectiveTempoMonths(brand: Brand): { months: number | null; basis: "actual" | "expected" | "none" } {
  const actual =
    outcomeOf(brand.status) === "open" ? null : monthsBetween(brand.initialContact, brand.closingFailed);
  if (actual != null) return { months: actual, basis: "actual" };

  const expected = brand.expectedMonths ?? brand.scores?.tempoMonths ?? null;
  return expected == null ? { months: null, basis: "none" } : { months: expected, basis: "expected" };
}

/**
 * The lead's scores with tempo brought up to date.
 *
 * Everything downstream reads through here so there is one score, not a
 * "sheet score" and a "real score" disagreeing on two pages.
 */
export function effectiveScores(brand: Brand): BrandScores | undefined {
  const s = brand.scores;
  if (!s) return undefined;

  const { months } = effectiveTempoMonths(brand);
  if (months == null) return s;

  const tempo = tempoScore(months);
  if (tempo === s.tempoScore && months === s.tempoMonths) return s;

  const next: BrandScores = { ...s, tempoMonths: months, tempoScore: tempo };
  next.economicalEfficiency = economicalEfficiency(next) ?? s.economicalEfficiency;
  return next;
}

/** Composite lead score (0–5) blending value-efficiency and access. */
export function leadScore(brand: Brand): number | null {
  const s = effectiveScores(brand);
  if (!s || s.economicalEfficiency == null || s.easeOfAccess == null) return null;
  return Number((s.economicalEfficiency * 0.55 + s.easeOfAccess * 0.45).toFixed(3));
}

export type Quadrant = "Prioritize" | "Quick Win" | "Strategic" | "Deprioritize";

/* ------------------------------------------------------------------ */
/*  Pipeline weighting (heuristic win-probability per stage)           */
/* ------------------------------------------------------------------ */
export const STAGE_PROBABILITY: Record<BrandStatus, number> = {
  "Deal Closed": 1.0,
  Recurring: 0.85,
  Advanced: 0.6,
  "Follow Up": 0.4,
  Early: 0.25,
  "Back to Attack": 0.15,
  "Still to open": 0.05,
  "Did not work out": 0.0,
};

export function winProbability(status: BrandStatus | null): number {
  return status ? STAGE_PROBABILITY[status] ?? 0 : 0;
}

/** Expected (probability-weighted) value of a lead, in €. */
export function weightedValue(brand: Brand): number {
  const budget = brand.scores?.budget ?? 0;
  return budget * winProbability(brand.status);
}

/* ------------------------------------------------------------------ */
/*  Presentation helpers                                               */
/* ------------------------------------------------------------------ */
export const STATUS_TOKEN: Record<BrandStatus, string> = {
  "Deal Closed": "var(--color-status-closed)",
  Advanced: "var(--color-status-advanced)",
  "Follow Up": "var(--color-status-followup)",
  Early: "var(--color-status-early)",
  Recurring: "var(--color-status-recurring)",
  "Back to Attack": "var(--color-status-attack)",
  "Did not work out": "var(--color-status-lost)",
  "Still to open": "var(--color-status-open)",
};

const PRIORITY_ORDER: readonly Priority[] = ["Cold Lead", "Warm Lead", "Hot Lead"];

/** Colour ramp aligned to PRIORITY_ORDER — green = act now, red = cold. Reverse this line to flip to hot = red. */
const PRIORITY_RAMP: readonly string[] = ["var(--color-rose)", "var(--color-amber)", "var(--color-mint)"];

export const PRIORITY_TOKEN: Record<Priority, string> = Object.fromEntries(
  PRIORITY_ORDER.map((p, i) => [p, PRIORITY_RAMP[i]]),
) as Record<Priority, string>;

export function valuationToken(v: Valuation | null): string {
  if (v === "High") return "var(--color-heat-high)";
  if (v === "Medium") return "var(--color-heat-medium)";
  if (v === "Low") return "var(--color-heat-low)";
  return "var(--color-ink-faint)";
}

export const eur = (n: number): string =>
  new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
