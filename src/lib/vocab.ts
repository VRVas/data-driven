import type { BrandStatus, Priority, Industry } from "./types";

// Controlled vocabularies - mirror the original workbook's data-validation lists.
export const BRAND_STATUSES: readonly BrandStatus[] = [
  "Seed",
  "Qualify lead",
  "Shape proposal",
  "Closed deal",
  "Recurring",
  "Lost",
];

/**
 * The workbook's eight stages, and what each became.
 *
 * Early, Follow Up and Back to Attack all collapse into Qualify lead: the new
 * vocabulary is a straight funnel, and all three described the same phase -
 * working out whether the lead is real. Back to Attack was the revival case,
 * which is now Lost -> Qualify lead in the transition graph rather than a
 * stage of its own.
 *
 * Records written under the old names are still in Cosmos, so reads translate
 * rather than migrate - see `normaliseBrand`.
 */
export const LEGACY_STATUSES: Readonly<Record<string, BrandStatus>> = {
  "Still to open": "Seed",
  Early: "Qualify lead",
  "Follow Up": "Qualify lead",
  "Back to Attack": "Qualify lead",
  Advanced: "Shape proposal",
  "Deal Closed": "Closed deal",
  "Did not work out": "Lost",
};

/** True for a stage already written in today's vocabulary. */
export function isBrandStatus(raw: unknown): raw is BrandStatus {
  return typeof raw === "string" && (BRAND_STATUSES as readonly string[]).includes(raw);
}

/** Any stored stage as today's vocabulary, or null if it is not one at all. */
export function toBrandStatus(raw: unknown): BrandStatus | null {
  if (typeof raw !== "string" || raw === "") return null;
  if (isBrandStatus(raw)) return raw;
  return LEGACY_STATUSES[raw] ?? null;
}

export const PRIORITIES: readonly Priority[] = ["High", "Medium", "Low"];

/**
 * The workbook called these Hot/Warm/Cold Lead. Records written under those
 * names are still in Cosmos, so reads translate rather than migrate - see
 * `normaliseBrand`. Keep this map even once nothing old is left; it costs one
 * lookup and it is the only thing standing between a stale row and a blank
 * priority.
 */
export const LEGACY_PRIORITIES: Readonly<Record<string, Priority>> = {
  "Hot Lead": "High",
  "Warm Lead": "Medium",
  "Cold Lead": "Low",
};

/** True for a value already written in today's vocabulary. */
export function isPriority(raw: unknown): raw is Priority {
  return typeof raw === "string" && (PRIORITIES as readonly string[]).includes(raw);
}

/** Any stored priority as today's vocabulary, or null if it is not one at all. */
export function toPriority(raw: unknown): Priority | null {
  if (typeof raw !== "string" || raw === "") return null;
  if (isPriority(raw)) return raw;
  return LEGACY_PRIORITIES[raw] ?? null;
}

// Agents/agencies use a shorter status list (from the AgentsAgencies sheet).
export const AGENT_STATUSES: readonly string[] = [
  "Qualify lead",
  "Shape proposal",
  "Closed deal",
  "Recurring",
];

export const INDUSTRIES: readonly Industry[] = [
  "Finance",
  "FMCG",
  "Fashion",
  "Tech/Telecom",
  "Automotive",
  "Fair",
  "Professional Services",
  "Other",
];
