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
