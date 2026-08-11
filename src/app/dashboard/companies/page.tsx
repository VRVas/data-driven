import Link from "next/link";
import { redirect } from "next/navigation";
import { KpiCard } from "@/components/KpiCard";
import { Reveal } from "@/components/Reveal";
import { can } from "@/lib/auth/authorize";
import { getCrmGraph, getPipelineMoney } from "@/lib/crm/graph";
import { duplicateCandidates } from "@/lib/crm/logic";
import type { CompanyRollup } from "@/lib/crm/types";
import { eur } from "@/lib/scoring";

export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  if (!(await can("lead:read"))) redirect("/dashboard");

  const [graph, money] = await Promise.all([getCrmGraph(), getPipelineMoney()]);
  const companies = [...graph.companies].sort(
    (a, b) => b.rollup.openPipelineValue - a.rollup.openPipelineValue,
  );
  const duplicates = duplicateCandidates(graph.companies);

  return (
    <div className="space-y-8">
      <Reveal>
        <div className="eyebrow mb-2">Accounts</div>
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
            <div className="eyebrow mb-1">Book of business</div>
            <h2 className="font-display text-xl font-semibold tracking-tight">By open pipeline</h2>
          </header>

          {companies.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[var(--color-ink-muted)] sm:px-6">
              No companies yet — they appear as soon as there are leads.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--color-border)]">
                  <tr className="text-left">
                    <th className="eyebrow px-4 py-3 sm:px-6">Company</th>
                    <th className="eyebrow hidden px-4 py-3 sm:table-cell sm:px-6">Industry</th>
                    <th className="eyebrow px-4 py-3 sm:px-6">Deals</th>
                    <th className="eyebrow px-4 py-3 text-right sm:px-6">Open pipeline</th>
                    <th className="eyebrow hidden px-4 py-3 text-right md:table-cell sm:px-6">Lifetime</th>
                    <th className="eyebrow hidden px-4 py-3 text-right lg:table-cell sm:px-6">Repeat</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((c) => (
                    <tr key={c.id} className="border-t border-[var(--color-border)] align-top">
                      <td className="px-4 py-3 sm:px-6">
                        <Link href={`/dashboard/companies/${c.id}`} className="font-medium hover:text-[var(--color-brand)]">
                          {c.name}
                        </Link>
                        <div className="mt-0.5 text-[11px] text-[var(--color-ink-faint)] sm:hidden">
                          {c.industry ?? "No industry"}
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 text-[var(--color-ink-muted)] sm:table-cell sm:px-6">
                        {c.industry ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-[var(--color-ink-muted)] sm:px-6">{dealSummary(c.rollup)}</td>
                      <td className="px-4 py-3 text-right tabular-nums sm:px-6">{eur(c.rollup.openPipelineValue)}</td>
                      <td className="hidden px-4 py-3 text-right tabular-nums md:table-cell sm:px-6">
                        {eur(c.rollup.lifetimeValue)}
                      </td>
                      <td className="hidden px-4 py-3 text-right tabular-nums lg:table-cell sm:px-6">
                        {c.rollup.repeatValue > 0 ? (
                          <span className="text-[var(--color-mint)]">{eur(c.rollup.repeatValue)}</span>
                        ) : (
                          <span className="text-[var(--color-ink-faint)]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </Reveal>

      {duplicates.length > 0 && (
        <Reveal>
          <section className="glass p-4 sm:p-6">
            <div className="eyebrow mb-1">Review</div>
            <h2 className="font-display text-xl font-semibold tracking-tight">Possible duplicates</h2>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
              These names look alike, which is not the same as being the same client — &ldquo;Allianz Bank&rdquo; and
              &ldquo;Allianz CH&rdquo; may well be two customers. Nothing is ever merged automatically; open them and
              link the deals yourself if they belong together.
            </p>
            <ul className="mt-4 space-y-2">
              {duplicates.map((group) => (
                <li
                  key={group.map((c) => c.id).join("|")}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                >
                  {group.map((c, i) => (
                    <span key={c.id} className="flex items-center gap-2">
                      {i > 0 && <span className="text-[var(--color-ink-faint)]">·</span>}
                      <Link href={`/dashboard/companies/${c.id}`} className="hover:text-[var(--color-brand)]">
                        {c.name}
                      </Link>
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        </Reveal>
      )}
    </div>
  );
}

function dealSummary(r: CompanyRollup): string {
  const parts: string[] = [];
  if (r.openDealCount) parts.push(`${r.openDealCount} open`);
  if (r.wonDealCount) parts.push(`${r.wonDealCount} won`);
  if (r.lostDealCount) parts.push(`${r.lostDealCount} lost`);
  return parts.join(" · ") || "—";
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
        —
      </div>
      <div className="mt-1.5 text-sm text-[var(--color-ink-muted)]">{hint}</div>
    </div>
  );
}
