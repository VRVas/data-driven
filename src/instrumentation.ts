// Next.js runtime instrumentation (runs once per server process on boot).
// The production Cosmos DB is private (VNet-only), so it can only be seeded
// from inside the app. On boot we trigger the store's idempotent first-run
// seed so a freshly provisioned database shows the baseline dataset from the
// sheet immediately - no login required.
//
// The node-only work is kept inside the `NEXT_RUNTIME === "nodejs"` guard so
// the store's `node:fs`/`node:path` imports are dead-code-eliminated from the
// Edge (middleware) bundle.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    startReminderLoop();

    // Dev uses the local file store (self-seeding); only act when Cosmos-backed.
    if (!process.env.COSMOS_ENDPOINT) return;
    try {
      const [{ getBrandStore }, { getAgentStore }] = await Promise.all([
        import("@/lib/store/brands"),
        import("@/lib/store/agents"),
      ]);
      // list() seeds an empty container from the cleaned dataset (idempotent).
      const [brands, agents] = await Promise.all([
        getBrandStore().list(),
        getAgentStore().list(),
      ]);
      console.log(
        `[instrumentation] Cosmos seed check complete: ${brands.length} brands, ${agents.length} agents.`,
      );
    } catch (err) {
      console.error("[instrumentation] Cosmos seed check failed:", err);
    }
  }
}

/**
 * Deliver due reminders from inside the process.
 *
 * The API route is the real mechanism - a scheduler owns the timing, survives
 * a restart and can be observed. This loop exists so the feature works at all
 * without one: locally, and on a single always-warm replica, which is how this
 * app is deployed.
 *
 * Off by default in multi-replica setups, and harmless if it does run
 * alongside a scheduler: dispatch claims each reminder before sending, so the
 * two cannot both deliver it.
 */
function startReminderLoop() {
  const minutes = Number(process.env.REMINDER_LOOP_MINUTES ?? 1);
  if (!Number.isFinite(minutes) || minutes <= 0) return;

  const tick = async () => {
    try {
      const { dispatchDueReminders } = await import("@/lib/reminders/dispatch");
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
