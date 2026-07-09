import type { IndustryStat, Valuation } from "./types";

/** How much a segment's value amplifies an opportunity (High > Medium > Low). */
export const VALUATION_WEIGHT: Record<Valuation, number> = {
  High: 1,
  Medium: 0.6,
  Low: 0.3,
};

/** Share of the addressable market already approached (0–1), or null if unknown. */
export function penetration(opened: number, total: number | null): number | null {
  return total && total > 0 ? opened / total : null;
}

/** Untapped companies (addressable − approached), floored at 0. */
export function whitespace(opened: number, total: number | null): number | null {
  return total != null ? Math.max(0, total - opened) : null;
}

/**
 * Opportunity index (0–1): value weight × untapped share.
 * High-value, barely-approached segments score highest.
 */
export function opportunityScore(ind: Pick<IndustryStat, "opened" | "companiesEU" | "valuation">): number {
  const pen = penetration(ind.opened, ind.companiesEU) ?? 0;
  const weight = ind.valuation ? VALUATION_WEIGHT[ind.valuation] : VALUATION_WEIGHT.Low;
  return Number((weight * (1 - pen)).toFixed(3));
}

/** Rank industries by opportunity, richest whitespace first. */
export function rankByOpportunity(industries: IndustryStat[]): IndustryStat[] {
  return [...industries].sort((a, b) => opportunityScore(b) - opportunityScore(a));
}
