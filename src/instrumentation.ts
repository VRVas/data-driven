// Next.js runtime instrumentation (runs once per server process on boot).
// The production Cosmos DB is private (VNet-only), so it can only be seeded
// from inside the app. On boot we trigger the store's idempotent first-run
// seed so a freshly provisioned database shows the baseline dataset from the
// sheet immediately - no login required.
//
// The node-only work is kept inside the `NEXT_RUNTIME === "nodejs"` guard so
// the store's `node:fs`/`node:path` imports are dead-code-eliminated from the
// Edge (middleware) bundle. Two things about that guard are load-bearing:
// it must WRAP the work as a block - webpack folds `if ("edge" === "nodejs")`
// away, but cannot prove the statements after an early return are unreachable
// - and every node import inside it must be dynamic.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { startReminderLoop } = await import("@/lib/reminders/loop");
      startReminderLoop();
    } catch (err) {
      console.error("[instrumentation] reminder loop failed to start:", err);
    }

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
