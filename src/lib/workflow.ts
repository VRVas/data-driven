import type { Brand, BrandStatus } from "./types";

/**
 * Allowed pipeline stage transitions — a small directed graph over the workbook's
 * status vocabulary. Keeps the pipeline honest (no illegal jumps) and drives the
 * quick-advance control on the lead page.
 */
export const STATUS_FLOW: Record<BrandStatus, BrandStatus[]> = {
  "Still to open": ["Early", "Did not work out"],
  Early: ["Follow Up", "Advanced", "Back to Attack", "Did not work out"],
  "Follow Up": ["Advanced", "Back to Attack", "Early", "Did not work out"],
  Advanced: ["Deal Closed", "Follow Up", "Back to Attack", "Did not work out"],
  "Back to Attack": ["Follow Up", "Advanced", "Early", "Did not work out"],
  Recurring: ["Advanced", "Deal Closed", "Follow Up"],
  "Deal Closed": ["Recurring", "Back to Attack"],
  "Did not work out": ["Back to Attack", "Early"],
};

/** When a lead has no status yet, these are the sensible entry points. */
export const ENTRY_STATUSES: BrandStatus[] = ["Still to open", "Early", "Follow Up", "Advanced"];

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
 * Date side-effects when entering a status (pure — `today` injected):
 *  - any move counts as a touch → refresh `lastContact`;
 *  - closing/losing a deal stamps `closingFailed` (if not already set);
 *  - entering "Follow Up" seeds a follow-up a week out when none exists.
 */
export function statusSideEffects(
  brand: Pick<Brand, "followUpDate" | "closingFailed">,
  to: BrandStatus,
  today: string,
): Partial<Pick<Brand, "lastContact" | "followUpDate" | "closingFailed">> {
  const patch: Partial<Pick<Brand, "lastContact" | "followUpDate" | "closingFailed">> = {
    lastContact: today,
  };
  if (to === "Deal Closed" || to === "Did not work out") {
    patch.closingFailed = brand.closingFailed ?? today;
  }
  if (to === "Follow Up" && !brand.followUpDate) {
    patch.followUpDate = addDays(today, 7);
  }
  return patch;
}
