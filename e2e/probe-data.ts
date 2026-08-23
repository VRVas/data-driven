import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Remove the lead `wiring.spec.ts` creates.
 *
 * The E2E account is a member, and members cannot delete leads. That is the
 * right permission model, so the spec cannot tidy up through the UI. This runs
 * at both ends: as teardown so a finished run leaves nothing behind, and again
 * during setup so a run that was interrupted before teardown cannot poison the
 * next one - the spec asserts on totals, and a stale probe lead moves them.
 *
 * Mirrors deleteBrand: the lead, its proposals, and any company link to it.
 */
const PROBE = /^zz-wiring-probe/;

async function rewrite<T>(file: string, edit: (data: T) => T): Promise<void> {
  try {
    const raw = await fs.readFile(file, "utf8");
    await fs.writeFile(file, JSON.stringify(edit(JSON.parse(raw) as T), null, 2), "utf8");
  } catch {
    // No store yet, or nothing to clean.
  }
}

export async function purgeProbeData(): Promise<void> {
  const dataDir = path.join(process.cwd(), ".data");

  await rewrite<Array<{ id: string }>>(path.join(dataDir, "brands.json"), (brands) =>
    brands.filter((b) => !PROBE.test(b.id)),
  );

  await rewrite<{ proposals: Array<{ dealId: string }>; links: Array<{ dealId: string }> }>(
    path.join(dataDir, "crm.json"),
    (crm) => ({
      ...crm,
      proposals: crm.proposals.filter((p) => !PROBE.test(p.dealId)),
      links: crm.links.filter((l) => !PROBE.test(l.dealId)),
    }),
  );
}

export default purgeProbeData;
