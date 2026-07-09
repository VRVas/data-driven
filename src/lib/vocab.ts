import type { BrandStatus, Priority, Industry } from "./types";

// Controlled vocabularies — mirror the original workbook's data-validation lists.
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

export const PRIORITIES: readonly Priority[] = ["Hot Lead", "Warm Lead", "Cold Lead"];

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
