import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Remove what the probing specs create.
 *
 * The E2E account is a member, and members cannot delete leads. That is the
 * right permission model, so the specs cannot tidy up through the UI. This
 * runs at both ends: as teardown so a finished run leaves nothing behind, and
 * again during setup so a run that was interrupted before teardown cannot
 * poison the next one - the specs assert on totals and on "the first row", and
 * a stale probe row moves both.
 *
 * Mirrors deleteBrand: the lead, its proposals, and any company link to it.
 */
const PROBE = /^zz-wiring-probe/;
const PROBE_TITLE = /^ZZ /;

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

  // Reminders and the notifications they raise, which reminders.spec.ts
  // creates by title rather than by id.
  await rewrite<Array<{ title: string }>>(path.join(dataDir, "reminders.json"), (rows) =>
    rows.filter((r) => !PROBE_TITLE.test(r.title)),
  );
  await rewrite<Array<{ title: string }>>(path.join(dataDir, "notifications.json"), (rows) =>
    rows.filter((n) => !PROBE_TITLE.test(n.title)),
  );

  // Comments live on real leads rather than on a probe lead, since members
  // cannot create or delete one, so they are found by their body.
  await rewrite<Array<{ body: string }>>(path.join(dataDir, "comments.json"), (rows) =>
    rows.filter((c) => !PROBE_TITLE.test(c.body)),
  );
}

export default purgeProbeData;
