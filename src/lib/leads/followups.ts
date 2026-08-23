import { addDays, todayYmd } from "@/lib/workflow";
import { daysUntil } from "@/lib/time";
import type { Brand } from "@/lib/types";

/**
 * Follow-ups: deriving them from leads, and what "handled" and "later" mean.
 *
 * Pure, and shared by the reminders screen, the top bar and the copilot, so
 * none of them can disagree about which leads are due or about whether
 * completing a follow-up also counts as a touch.
 *
 * A follow-up is DERIVED from a lead's followUpDate. A reminder (see
 * store/reminders) is a record somebody created on purpose. They appear
 * together on the same screen and are not the same thing.
 */

export type FollowUpBucket = "overdue" | "today" | "upcoming";

export interface FollowUp {
  brand: Brand;
  date: string; // follow-up date (YYYY-MM-DD)
  days: number; // whole days from today (negative = overdue)
  bucket: FollowUpBucket;
}

export function bucketFor(days: number): FollowUpBucket {
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  return "upcoming";
}

/**
 * Closed and lost leads are excluded - no action is needed - and anything past
 * `horizon` days is dropped. Sorted soonest-first, most overdue at the top.
 */
export function followUpsFrom(brands: Brand[], now: Date = new Date(), horizon = 30): FollowUp[] {
  const out: FollowUp[] = [];
  for (const b of brands) {
    if (!b.followUpDate) continue;
    if (b.status === "Deal Closed" || b.status === "Did not work out") continue;
    const days = daysUntil(b.followUpDate, now);
    if (Number.isNaN(days) || days > horizon) continue;
    out.push({ brand: b, date: b.followUpDate, days, bucket: bucketFor(days) });
  }
  return out.sort((a, b) => a.days - b.days);
}

/** Count needing attention now (overdue + due today). */
export function countDue(followUps: FollowUp[]): number {
  return followUps.filter((r) => r.bucket !== "upcoming").length;
}

/** Handled: the date clears and today becomes the last contact. */
export function completeFollowUp(brand: Brand, today: string = todayYmd()): Brand {
  return { ...brand, followUpDate: null, lastContact: today };
}

/**
 * Later: push the date out from today, not from the old one, so snoozing a
 * long-overdue lead lands in the future rather than still in the past.
 */
export function snoozeFollowUp(brand: Brand, days: number, today: string = todayYmd()): Brand {
  return { ...brand, followUpDate: addDays(today, days) };
}
