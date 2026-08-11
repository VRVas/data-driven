import type { Brand, BrandScores, BrandStatus } from "./types";

/**
 * Lifecycle — is a lead still live?
 *
 * The sheet's `status` vocabulary mixes pipeline STAGE ("Early", "Advanced")
 * with OUTCOME ("Deal Closed", "Did not work out"). Ranked lists and targeting
 * charts are about where to spend effort next, so they must exclude anything
 * already finished. Deriving this rather than storing it keeps `status` the
 * single source of truth and removes any chance of the two drifting apart.
 */
export type Outcome = "open" | "won" | "lost";

const WON_STATUS: BrandStatus = "Deal Closed";
const LOST_STATUS: BrandStatus = "Did not work out";

/**
 * `status` wins over `scores.process` because it is the only one of the two a
 * user can actually edit — `process` is a frozen import artefact with no UI.
 */
export function outcomeOf(status: BrandStatus | null | undefined): Outcome {
  if (status === WON_STATUS) return "won";
  if (status === LOST_STATUS) return "lost";
  return "open";
}

export function isOpen(brand: Pick<Brand, "status">): boolean {
  return outcomeOf(brand.status) === "open";
}

/** Open leads only — the base for every ranking and targeting view. */
export function openLeads<T extends Pick<Brand, "status">>(brands: T[]): T[] {
  return brands.filter(isOpen);
}

export interface OutcomeConflict {
  id: string;
  name: string;
  status: BrandStatus | null;
  process: NonNullable<BrandScores["process"]>;
  outcome: Outcome;
}

/**
 * `scores.process` disagreeing with `status` is rarely a typo — it usually
 * means one row is carrying two engagements (a won deal plus a live one, or a
 * failed attempt followed by a fresh approach). Surfaced for review rather
 * than silently reconciled.
 */
export function outcomeConflictOf(brand: Brand): OutcomeConflict | null {
  const process = brand.scores?.process;
  if (!process) return null;
  const outcome = outcomeOf(brand.status);
  if ((process === "Open") === (outcome === "open")) return null;
  return { id: brand.id, name: brand.name, status: brand.status, process, outcome };
}

export function outcomeConflicts(brands: Brand[]): OutcomeConflict[] {
  return brands
    .map(outcomeConflictOf)
    .filter((c): c is OutcomeConflict => c !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}
