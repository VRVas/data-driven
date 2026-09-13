import type { Brand, BrandScores, BrandStatus } from "./types";

/**
 * Lifecycle - is a lead still live?
 *
 * The sheet's `status` vocabulary mixes pipeline STAGE ("Qualify lead",
 * "Shape proposal") with OUTCOME ("Closed deal", "Lost"). Ranked lists and
 * targeting charts are about where to spend effort next, so they must exclude
 * anything already finished. Deriving this rather than storing it keeps
 * `status` the single source of truth and removes any chance of the two
 * drifting apart.
 */
export type Outcome = "open" | "won" | "lost";

const WON_STATUS: BrandStatus = "Closed deal";
const LOST_STATUS: BrandStatus = "Lost";

/**
 * `status` wins over `scores.process` because it is the only one of the two a
 * user can actually edit - `process` is a frozen import artefact with no UI.
 */
export function outcomeOf(status: BrandStatus | null | undefined): Outcome {
  if (status === WON_STATUS) return "won";
  if (status === LOST_STATUS) return "lost";
  return "open";
}

export function isOpen(brand: Pick<Brand, "status">): boolean {
  return outcomeOf(brand.status) === "open";
}

/** Open leads only - the base for every ranking and targeting view. */
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
 * `scores.process` disagreeing with `status` is rarely a typo - it usually
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

/**
 * Bring the imported outcome into line with the stage a human has just set.
 *
 * `process` came from the spreadsheet's own outcome column and had no UI, so a
 * lead correctly marked "Lost" in the app kept being reported as
 * disagreeing with an imported "Open" forever - the warning named a field the
 * user could not reach, and nothing they did could clear it.
 *
 * Once someone states the outcome here, the import is stale by definition.
 * Returns the same object when there is nothing to reconcile.
 */
export function reconcileImportedOutcome(brand: Brand): Brand {
  const s = brand.scores;
  if (!s?.process) return brand;
  const outcome = outcomeOf(brand.status);
  if ((s.process === "Open") === (outcome === "open")) return brand;

  const process = outcome === "open" ? "Open" : outcome === "won" ? "Closed" : "Failed";
  return { ...brand, scores: { ...s, process } };
}
