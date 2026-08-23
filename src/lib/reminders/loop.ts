import "server-only";
import { dispatchDueReminders } from "./dispatch";

/**
 * Deliver due reminders from inside the web process.
 *
 * The API route is the real mechanism: a scheduler owns the timing, survives a
 * restart and can be observed. This exists so the feature works with no
 * scheduler at all - locally, and on the single always-warm replica this app
 * is deployed as.
 *
 * Harmless alongside a scheduler, because dispatch claims each reminder before
 * sending, so the two cannot both deliver it.
 *
 * Lives in its own module rather than in instrumentation.ts: that file is
 * compiled for the Edge runtime as well, and a function declared at its top
 * level keeps its imports even when the only call is inside a nodejs-only
 * branch - which drags node:fs into the Edge bundle and fails the build.
 */
let started = false;

export function startReminderLoop(): void {
  if (started) return;
  const minutes = Number(process.env.REMINDER_LOOP_MINUTES ?? 1);
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  started = true;

  const tick = async () => {
    try {
      const summary = await dispatchDueReminders();
      if (summary.delivered || summary.failed) {
        console.log(`[reminders] delivered ${summary.delivered}, failed ${summary.failed}`);
      }
    } catch (err) {
      // A failed sweep must not take the server down; the next one retries.
      console.error("[reminders] dispatch failed:", err);
    }
  };

  const timer = setInterval(tick, minutes * 60_000);
  // Never hold the process open on its own account.
  timer.unref?.();
  void tick();
}
