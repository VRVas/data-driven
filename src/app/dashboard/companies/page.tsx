import Link from "next/link";
import { redirect } from "next/navigation";
import { KpiCard } from "@/components/KpiCard";
import { Reveal } from "@/components/Reveal";
import { can } from "@/lib/auth/authorize";
import { getCrmGraph, getPipelineMoney } from "@/lib/crm/graph";
import { duplicateCandidates } from "@/lib/crm/logic";
import { eur } from "@/lib/scoring";
import { CompanyTable } from "@/components/crm/CompanyTable";
import { MergeCompanies } from "@/components/crm/MergeCompanies";

export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  if (!(await can("lead:read"))) redirect("/dashboard");

  const [graph, money, canMerge] = await Promise.all([
    getCrmGraph(),
    getPipelineMoney(),
    can("company:merge"),
  ]);
  const companies = [...graph.companies].sort(
    (a, b) => b.rollup.openPipelineValue - a.rollup.openPipelineValue,
  );
  const duplicates = duplicateCandidates(graph.companies);
  const mergeChoices = [...graph.companies]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({
      id: c.id,
      name: c.name,
      dealCount: graph.deals.filter((d) => d.companyId === c.id).length,
    }));

  return (
    <div className="space-y-8">
      <Reveal>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Companies</h1>
        <p className="mt-1 text-[var(--color-ink-muted)]">
          {companies.length} {companies.length === 1 ? "company" : "companies"}. A company holds every deal we have
          ever run with that client, so repeat business finally adds up.
        </p>
      </Reveal>

      <Reveal stagger className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Open pipeline" value={money.openPipeline} format="eur" hint="across open deals" />
        <KpiCard
          label="Awaiting decision"
          value={money.awaitingDecision}
          format="eur"
          hint="proposals sent, no answer yet"
          accent="var(--color-amber)"
        />
        <KpiCard
          label="Repeat revenue"
          value={money.repeatValue}
          format="eur"
          hint={`${money.companiesWithRepeatBusiness} ${
            money.companiesWithRepeatBusiness === 1 ? "company" : "companies"
          } with more than one win`}
          accent="var(--color-mint)"
        />
        {money.proposalWinRate == null ? (
          <EmptyKpi label="Proposal win rate" hint="of decided proposals" accent="var(--color-cyan)" />
        ) : (
          <KpiCard
            label="Proposal win rate"
            value={money.proposalWinRate * 100}
            format="percent"
            hint="of decided proposals"
            accent="var(--color-cyan)"
          />
        )}
      </Reveal>

      <Reveal>
        <section className="glass overflow-hidden">
          <header className="border-b border-[var(--color-border)] px-4 py-4 sm:px-6">
            <h2 className="font-display text-xl font-semibold tracking-tight">By open pipeline</h2>
          </header>

          {companies.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[var(--color-ink-muted)] sm:px-6">
              No companies yet - they appear as soon as there are leads.
            </p>
          ) : (
            <CompanyTable companies={companies} />
          )}
        </section>
      </Reveal>

      <Reveal>
        <section className="glass p-4 sm:p-6">
          <h2 className="font-display text-xl font-semibold tracking-tight">Where each figure comes from</h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--color-ink-muted)]">
            One value per deal, strongest evidence first: an <strong>accepted</strong> proposal, else the one
            currently <strong>sent</strong> and awaiting a decision, else the estimate typed when the lead
            opened. An acceptance does not expire, so a later draft or a rejected re-quote cannot displace it.
          </p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
              <dt className="text-sm font-medium">Open pipeline</dt>
              <dd className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
                Deals still open - every stage except Deal Closed and Did not work out.
              </dd>
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
              <dt className="text-sm font-medium">Awaiting decision</dt>
              <dd className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
                Proposals whose newest revision is <strong>sent</strong>. A re-quote replaces the old figure
                rather than adding to it.
              </dd>
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
              <dt className="text-sm font-medium">Lifetime value</dt>
              <dd className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
                Deals at Deal Closed. Repeat value is everything after the first win.
              </dd>
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
              <dt className="text-sm font-medium">Proposal win rate</dt>
              <dd className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
                Accepted ÷ decided, one vote per deal. A deal re-quoted twice and won counts once.
              </dd>
            </div>
          </dl>
        </section>
      </Reveal>

      {(duplicates.length > 0 || canMerge) && (
        <Reveal>
          <section className="glass p-4 sm:p-6">
            <h2 className="font-display text-xl font-semibold tracking-tight">
              {duplicates.length > 0 ? "Possible duplicates" : "Merge companies"}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
              {duplicates.length > 0 ? (
                <>
                  These names look alike, which is not the same as being the same client -
                  &ldquo;Allianz Bank&rdquo; and &ldquo;Allianz CH&rdquo; may well be two customers. Nothing is
                  ever merged automatically.
                </>
              ) : (
                <>
                  Nothing looks duplicated right now. If two records are the same client anyway, fold one into
                  the other here.
                </>
              )}
            </p>
            {duplicates.length > 0 && (
              <ul className="mt-4 space-y-2">
                {duplicates.map((group) => (
                  <li
                    key={group.map((c) => c.id).join("|")}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                  >
                    {group.map((c, i) => (
                      <span key={c.id} className="flex items-center gap-2">
                        {i > 0 && <span className="text-[var(--color-ink-faint)]">-</span>}
                        <Link href={`/dashboard/companies/${c.id}`} className="hover:text-[var(--color-brand)]">
                          {c.name}
                        </Link>
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            )}
            {canMerge ? (
              <MergeCompanies companies={mergeChoices} />
            ) : (
              <p className="mt-3 text-sm text-[var(--color-ink-faint)]">
                Open them and link the deals yourself if they belong together - merging is restricted.
              </p>
            )}
          </section>
        </Reveal>
      )}
    </div>
  );
}


/** Matches KpiCard, for the figures that genuinely have no value yet. */
function EmptyKpi({ label, hint, accent }: { label: string; hint: string; accent: string }) {
  return (
    <div className="beam-card glass relative overflow-hidden p-4 sm:p-5">
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
      />
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-faded-steel)] sm:text-[13px] lg:text-[var(--text-caption)]">
        {label}
      </div>
      <div className="mt-2 font-display text-xl font-semibold tracking-tight tabular-nums sm:text-2xl lg:text-3xl">
        -
      </div>
      <div className="mt-1.5 text-sm text-[var(--color-ink-muted)]">{hint}</div>
    </div>
  );
}
