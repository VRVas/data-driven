import Link from "next/link";
import { Reveal } from "@/components/Reveal";
import { ResolveConflictButton } from "@/components/crm/ResolveConflictButton";
import { can } from "@/lib/auth/authorize";
import { getDataQuality } from "@/lib/data";
import { getVisibleBrands } from "@/lib/leads/visible";
import { outcomeConflicts } from "@/lib/lifecycle";
import { ExportMenu } from "@/components/ExportMenu";

// Reads the live brand store for the split-lead check.
export const dynamic = "force-dynamic";

export default async function QualityPage() {
  const { issues, count } = getDataQuality();
  const conflicts = outcomeConflicts(await getVisibleBrands());
  const canUpdate = await can("lead:update");
  const groups = issues.reduce<Record<string, typeof issues>>((acc, i) => {
    const bucket = i.issue.includes("date") || i.key.includes("Contact")
      ? "Dates"
      : i.issue.includes("POC")
        ? "Types"
        : i.issue.includes("join")
          ? "Joins"
          : "Other";
    (acc[bucket] ??= []).push(i);
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      <Reveal>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="eyebrow mb-2">Data audit</div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Data quality</h1>
            <p className="mt-1 text-[var(--color-ink-muted)]">
              {count} issues detected and resolved during migration — full audit trail.
            </p>
          </div>
          <ExportMenu
            filename="data-quality"
            columns={[
              { key: "entity", label: "Entity" },
              { key: "key", label: "Field" },
              { key: "issue", label: "Issue" },
              { key: "fix", label: "Resolution" },
            ]}
            rows={issues as unknown as Record<string, unknown>[]}
          />
        </div>
      </Reveal>

      <Reveal stagger className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Object.entries(groups).map(([g, list]) => (
          <div key={g} className="glass p-5">
            <div className="eyebrow">{g}</div>
            <div className="mt-1 font-display text-3xl font-semibold">{list.length}</div>
          </div>
        ))}
      </Reveal>

      {conflicts.length > 0 && (
        <Reveal>
          <section className="glass p-6">
            <div className="eyebrow mb-2">Needs review</div>
            <h2 className="font-display text-lg font-semibold">
              {conflicts.length} leads look like two deals in one row
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-[var(--color-ink-muted)]">
              &ldquo;Imported outcome&rdquo; is the outcome column from the original spreadsheet, recorded at import
              and never edited since. Where it disagrees with the stage, one of two things is true: the stage is
              simply the newer answer, or the row is carrying two engagements (won, then re-approached; or lost,
              then a fresh attempt). Confirm the stage to close it, or open the lead and add the second deal
              under the same company.
            </p>
            <ul className="mt-4 space-y-2">
              {conflicts.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
                >
                  <Link
                    href={`/dashboard/pipeline/${c.id}`}
                    className="font-medium hover:text-[var(--color-brand-bright)] hover:underline"
                  >
                    {c.name}
                  </Link>
                  <span className="text-[var(--color-ink-muted)]">
                    stage <span className="text-[var(--color-ink)]">{c.status ?? "—"}</span>
                  </span>
                  <span className="text-[var(--color-ink-faint)]">vs</span>
                  <span className="text-[var(--color-ink-muted)]">
                    imported outcome <span className="text-[var(--color-ink)]">{c.process}</span>
                  </span>
                  {canUpdate && <ResolveConflictButton id={c.id} status={c.status ?? "unset"} />}
                </li>
              ))}
            </ul>
          </section>
        </Reveal>
      )}

      <Reveal>
        <div className="glass overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="bg-[var(--color-surface)]">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">Entity</th>
                  <th className="hidden px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)] sm:table-cell">Field</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">Issue</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">Resolution</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((i, idx) => (
                  <tr key={idx} className="border-t border-[var(--color-border)]">
                    <td className="px-4 py-2.5 font-medium">{i.entity}</td>
                    <td className="hidden px-4 py-2.5 text-[var(--color-ink-muted)] sm:table-cell">{i.key}</td>
                    <td className="px-4 py-2.5 text-[var(--color-ink-muted)]">{i.issue}</td>
                    <td className="px-4 py-2.5">
                      <span className="whitespace-nowrap rounded-full bg-[color-mix(in_srgb,var(--color-mint)_14%,transparent)] px-2 py-0.5 text-xs text-[var(--color-mint)]">
                        {i.fix}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
