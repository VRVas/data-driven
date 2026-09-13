import { reconcileImportedOutcome } from "./lifecycle";
import type { Brand, BrandStatus } from "./types";

/**
 * Allowed pipeline stage transitions - a small directed graph over the workbook's
 * status vocabulary. Keeps the pipeline honest (no illegal jumps) and drives the
 * quick-advance control on the lead page.
 */
export const STATUS_FLOW: Record<BrandStatus, BrandStatus[]> = {
  Seed: ["Qualify lead", "Lost"],
  "Qualify lead": ["Shape proposal", "Lost"],
  "Shape proposal": ["Closed deal", "Qualify lead", "Lost"],
  "Closed deal": ["Recurring"],
  Recurring: ["Shape proposal", "Closed deal"],
  // The revival path. "Back to Attack" used to be a stage of its own; going
  // after a dead lead again is just re-qualifying it.
  Lost: ["Qualify lead"],
};

/** When a lead has no status yet, these are the sensible entry points. */
export const ENTRY_STATUSES: BrandStatus[] = ["Seed", "Qualify lead", "Shape proposal"];

export function allowedTransitions(from: BrandStatus | null | undefined): BrandStatus[] {
  if (!from) return ENTRY_STATUSES;
  return STATUS_FLOW[from] ?? [];
}

export function canTransition(from: BrandStatus | null | undefined, to: BrandStatus): boolean {
  return allowedTransitions(from).includes(to);
}

export function todayYmd(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return todayYmd(dt);
}

/**
 * Date side-effects when entering a status (pure - `today` injected):
 *  - any move counts as a touch → refresh `lastContact`;
 *  - closing/losing a deal stamps `closingFailed` (if not already set);
 *  - entering "Qualify lead" seeds a follow-up a week out when none exists.
 */
export function statusSideEffects(
  brand: Pick<Brand, "followUpDate" | "closingFailed">,
  to: BrandStatus,
  today: string,
): Partial<Pick<Brand, "lastContact" | "followUpDate" | "closingFailed">> {
  const patch: Partial<Pick<Brand, "lastContact" | "followUpDate" | "closingFailed">> = {
    lastContact: today,
  };
  if (to === "Closed deal" || to === "Lost") {
    patch.closingFailed = brand.closingFailed ?? today;
  }
  // Was "Follow Up", which merged into this stage: qualifying a lead means you
  // owe them a next contact, so it gets a date rather than going quiet.
  if (to === "Qualify lead" && !brand.followUpDate) {
    patch.followUpDate = addDays(today, 7);
  }
  return patch;
}

/**
 * A stage move, whole: legality, date side-effects and the stale imported
 * outcome, in one decision.
 *
 * The screens and the copilot both move leads, and assembling this by hand in
 * two places had already drifted - chat left the imported-outcome conflict
 * flagged where the UI cleared it, so the same move produced two different
 * records depending on where it was made.
 */
export function advanceStage(
  brand: Brand,
  to: BrandStatus,
  today: string = todayYmd(),
): Brand | { error: string } {
  if (!canTransition(brand.status, to)) {
    return { error: `Can't move from ${brand.status ?? "unset"} to ${to}.` };
  }
  return reconcileImportedOutcome({ ...brand, status: to, ...statusSideEffects(brand, to, today) });
}
