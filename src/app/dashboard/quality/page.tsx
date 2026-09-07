import Link from "next/link";
import { Reveal } from "@/components/Reveal";
import { ResolveConflictButton } from "@/components/crm/ResolveConflictButton";
import { DuplicateCompanies } from "@/components/crm/DuplicateCompanies";
import { can } from "@/lib/auth/authorize";
import { getDataQuality } from "@/lib/data";
import { getVisibleBrands } from "@/lib/leads/visible";
import { getCrmGraph } from "@/lib/crm/graph";
import { duplicateCandidates } from "@/lib/crm/logic";
import { hygieneFindings, hygieneSummary } from "@/lib/pipeline/hygiene";
import { outcomeConflicts } from "@/lib/lifecycle";
import { ExportMenu } from "@/components/ExportMenu";

// Reads the live brand store for the split-lead check.
export const dynamic = "force-dynamic";

export default async function QualityPage() {
  const { issues, count } = getDataQuality();
  const brands = await getVisibleBrands();
  const conflicts = outcomeConflicts(brands);
  const findings = hygieneFindings(brands);
  const summary = hygieneSummary(findings);
  // One lead is one thing to go and fix, however many ways it is incomplete.
  // The work queue groups for the same reason: a list that names the same
  // client five times gets ignored.
  const grouped = Object.values(
    findings.reduce<Record<string, { id: string; name: string; worst: string; details: string[] }>>((acc, f) => {
      const row = (acc[f.id] ??= { id: f.id, name: f.name, worst: f.severity, details: [] });
      if (f.severity === "high") row.worst = "high";
      row.details.push(f.detail);
      return acc;
    }, {}),
  ).sort((a, b) => (a.worst === b.worst ? a.name.localeCompare(b.name) : a.worst === "high" ? -1 : 1));
  const canUpdate = await can("lead:update");
  const [graph, canMerge] = await Promise.all([getCrmGraph(), can("company:merge")]);
  const duplicates = duplicateCandidates(graph.companies);
  const mergeChoices = [...graph.companies]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({
      id: c.id,
      name: c.name,
      dealCount: graph.deals.filter((d) => d.companyId === c.id).length,
    }));
  const firstDealOf = (companyId: string) => graph.deals.find((d) => d.companyId === companyId)?.id ?? null;
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

  // The page is four unrelated jobs stacked vertically, and it was long enough
  // that the last one was never seen. Each is now an anchored section with a
  // count, so you can see from the top whether there is anything to do.
  const sections = [
    { id: "fix", label: "Needs fixing", count: summary.total, tone: "var(--color-rose)", present: true },
    // The conflicts section is only rendered when there are conflicts, so this
    // must not offer to jump to it when there are none.
    { id: "review", label: "Needs review", count: conflicts.length, tone: "var(--color-amber)", present: conflicts.length > 0 },
    { id: "duplicates", label: "Possible duplicates", count: duplicates.length, tone: "var(--color-cyan)", present: true },
    { id: "history", label: "Import history", count, tone: "var(--color-ink-faint)", present: true },
  ];

  return (
    <div className="space-y-8">
      <Reveal>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Data quality</h1>
            <p className="mt-1 text-[var(--color-ink-muted)]">
              What is wrong with the pipeline now, and what the original import had to clean.
            </p>
          </div>
          <ExportMenu
            filename="data-quality"
            columns={[
              { key: "name", label: "Lead" },
              { key: "severity", label: "Severity" },
              { key: "check", label: "Check" },
              { key: "detail", label: "Detail" },
            ]}
            rows={findings as unknown as Record<string, unknown>[]}
          />
        </div>
      </Reveal>

      <Reveal stagger className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {sections.map((s) => {
          const body = (
            <>
              <span className="text-sm text-[var(--color-ink-muted)]">{s.label}</span>
              <span
                className="font-display text-2xl font-semibold tabular-nums"
                style={{ color: s.count > 0 ? s.tone : "var(--color-ink-faint)" }}
              >
                {s.count}
              </span>
            </>
          );
          const shell = "glass flex items-baseline justify-between gap-3 p-4";
          return s.present ? (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={`${shell} transition-colors duration-200 hover:border-[var(--color-frosted-canvas)]`}
            >
              {body}
            </a>
          ) : (
            <div key={s.id} className={shell}>
              {body}
            </div>
          );
        })}
      </Reveal>

      <Reveal>
        <section id="fix" className="glass scroll-mt-24 p-6" data-testid="live-hygiene">
          <h2 className="font-display text-lg font-semibold">
            {summary.total === 0
              ? "Nothing outstanding"
              : `${summary.total} findings across ${summary.leadsAffected} ${summary.leadsAffected === 1 ? "lead" : "leads"}`}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--color-ink-muted)]">
            Recomputed from the current pipeline every time this page loads, so fixing a lead removes it
            from here. {summary.high} of these stop a lead being ranked or leave it unowned.
          </p>

          {findings.length > 0 && (
            <ul className="mt-4 space-y-1.5">
              {grouped.slice(0, 40).map((g) => (
                <li
                  key={g.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: g.worst === "high" ? "var(--color-rose)" : "var(--color-amber)" }}
                    aria-hidden
                  />
                  <Link href={`/dashboard/pipeline/${g.id}`} className="font-medium hover:text-[var(--color-brand)]">
                    {g.name}
                  </Link>
                  <span className="text-[var(--color-ink-muted)]">{g.details.join(" ")}</span>
                </li>
              ))}
            </ul>
          )}
          {grouped.length > 40 && (
            <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
              Showing the first 40 leads. Export for the rest.
            </p>
          )}
        </section>
      </Reveal>

      {conflicts.length > 0 && (
        <Reveal>
          <section id="review" className="glass scroll-mt-24 p-6">
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
                    stage <span className="text-[var(--color-ink)]">{c.status ?? "-"}</span>
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
        <div id="duplicates" className="scroll-mt-24">
          <DuplicateCompanies
            duplicates={duplicates}
            mergeChoices={mergeChoices}
            firstDealOf={firstDealOf}
            canMerge={canMerge}
          />
        </div>
      </Reveal>

      <Reveal>
        <div id="history" className="glass scroll-mt-24 overflow-hidden">
          <div className="border-b border-[var(--color-border)] px-4 py-4 sm:px-6">
            <h2 className="font-display text-lg font-semibold">Migration notes</h2>
            <p className="mt-1 max-w-3xl text-sm text-[var(--color-ink-muted)]">
              {count} issues the original spreadsheet import found and resolved. This list is a record of what
              happened once - it is not outstanding work and it does not change.
            </p>
            {/* These counts describe the table below, not the live pipeline.
                They used to sit directly under the live findings, where they
                read as four more things to go and fix. */}
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
              {Object.entries(groups).map(([g, list]) => (
                <div key={g} className="flex items-baseline gap-1.5">
                  <dt className="text-sm text-[var(--color-ink-muted)]">{g}</dt>
                  <dd className="font-display text-sm font-semibold tabular-nums">{list.length}</dd>
                </div>
              ))}
            </dl>
          </div>
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
