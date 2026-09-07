import type { BrandStatus, Priority, Industry } from "./types";

// Controlled vocabularies - mirror the original workbook's data-validation lists.
export const BRAND_STATUSES: readonly BrandStatus[] = [
  "Deal Closed",
  "Advanced",
  "Follow Up",
  "Early",
  "Recurring",
  "Back to Attack",
  "Did not work out",
  "Still to open",
];

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
  "Deal Closed",
  "Advanced",
  "Follow Up",
  "Early",
  "Recurring",
  "Back to Attack",
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
