import { addDays, todayYmd } from "@/lib/workflow";
import type { Brand } from "@/lib/types";

/**
 * What "handled" and "later" mean for a follow-up.
 *
 * Pure, and shared by the reminders screen and the copilot, so the two cannot
 * disagree about whether completing a follow-up also counts as a touch.
 */

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
