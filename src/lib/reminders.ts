import type { Brand } from "./types";
import { daysUntil } from "./time";

export type ReminderBucket = "overdue" | "today" | "upcoming";

export interface Reminder {
  brand: Brand;
  date: string; // follow-up date (YYYY-MM-DD)
  days: number; // whole days from today (negative = overdue)
  bucket: ReminderBucket;
}

export function bucketFor(days: number): ReminderBucket {
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  return "upcoming";
}

/**
 * Derive the follow-up reminder list from brands. Closed / lost leads are
 * excluded (no action needed) and anything past `horizon` days is dropped.
 * Sorted soonest-first (most overdue at the top).
 */
export function remindersFrom(brands: Brand[], now: Date = new Date(), horizon = 30): Reminder[] {
  const out: Reminder[] = [];
  for (const b of brands) {
    if (!b.followUp) continue;
    if (b.status === "Deal Closed" || b.status === "Did not work out") continue;
    const days = daysUntil(b.followUp, now);
    if (Number.isNaN(days) || days > horizon) continue;
    out.push({ brand: b, date: b.followUp, days, bucket: bucketFor(days) });
  }
  return out.sort((a, b) => a.days - b.days);
}

/** Count of reminders needing attention now (overdue + due today). */
export function countDue(reminders: Reminder[]): number {
  return reminders.filter((r) => r.bucket !== "upcoming").length;
}
