import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/Badge";
import { Reveal } from "@/components/Reveal";
import { CompanyProposals } from "@/components/crm/CompanyProposals";
import { NewDealButton } from "@/components/crm/NewDealButton";
import { ValueBasisNote } from "@/components/crm/ValueBasisNote";
import { can } from "@/lib/auth/authorize";
import { getCompanyDetail } from "@/lib/crm/graph";
import { dealValue } from "@/lib/crm/logic";
import type { Deal } from "@/lib/crm/types";
import { eur } from "@/lib/scoring";

export const dynamic = "force-dynamic";

const OUTCOME_ORDER: Record<Deal["outcome"], number> = { open: 0, won: 1, lost: 2 };

const day = (v: string | null): string => (v ? v.slice(0, 10) : "-");

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await can("lead:read"))) redirect("/dashboard");

  const detail = await getCompanyDetail(id);
  if (!detail) notFound();

  const { company, proposals } = detail;
  const rollup = company.rollup;
  const [canReadProposals, canManageProposals, canCreateLeads] = await Promise.all([
    can("proposal:read"),
    can("proposal:manage"),
    can("lead:create"),
  ]);

  const deals = [...detail.deals].sort(
    (a, b) =>
      OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome] ||
      (b.wonValue ?? dealValue(b, proposals).value) - (a.wonValue ?? dealValue(a, proposals).value),
  );
  const dealChoices = deals.map((d) => ({ id: d.id, name: d.name }));

  return (
    <div className="space-y-8">
      <Reveal>
        <Link
          href="/dashboard/companies"
          className="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          ← Companies
        </Link>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">{company.name}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {company.industry && <Badge>{company.industry}</Badge>}
          {company.owner && <Badge color="var(--color-cyan)">{company.owner}</Badge>}
          <span className="text-xs text-[var(--color-ink-faint)]">
            {deals.length} {deals.length === 1 ? "deal" : "deals"}
          </span>
        </div>
      </Reveal>

      <Reveal stagger className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="Lifetime value" value={eur(rollup.lifetimeValue)} accent="var(--color-brand)" />
        <Metric
          label="Repeat value"
          value={eur(rollup.repeatValue)}
          hint="won beyond the first deal"
          accent="var(--color-mint)"
        />
        <Metric label="Open pipeline" value={eur(rollup.openPipelineValue)} accent="var(--color-amber)" />
        <Metric
          label="Deal win rate"
          value={rollup.dealWinRate == null ? "-" : `${Math.round(rollup.dealWinRate * 100)}%`}
          hint={rollup.dealWinRate == null ? "nothing decided yet" : "of decided deals"}
          accent="var(--color-cyan)"
        />
      </Reveal>

      <Reveal>
        <section className="glass overflow-hidden">
          <header className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--color-border)] px-4 py-4 sm:px-6">
            <div>
              <h2 className="font-display text-xl font-semibold tracking-tight">Deals</h2>
              <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                Every piece of work with this client, live or finished.
              </p>
            </div>
            {canCreateLeads && <NewDealButton company={{ id: company.id, name: company.name }} />}
          </header>

          {deals.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[var(--color-ink-muted)] sm:px-6">
              No deals under this company yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--color-border)]">
                  <tr className="text-left">
                    <th className="eyebrow px-4 py-3 sm:px-6">Deal</th>
                    <th className="eyebrow hidden px-4 py-3 sm:table-cell sm:px-6">Stage</th>
                    <th className="eyebrow hidden px-4 py-3 md:table-cell sm:px-6">Type</th>
                    <th className="eyebrow px-4 py-3 text-right sm:px-6">Value</th>
                    <th className="eyebrow hidden px-4 py-3 lg:table-cell sm:px-6">Last contact</th>
                    <th className="eyebrow px-4 py-3 text-right sm:px-6">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {deals.map((d) => {
                    const resolved = d.wonValue == null ? dealValue(d, proposals) : null;
                    const value = d.wonValue ?? resolved!.value;
                    return (
                      <tr key={d.id} className="border-t border-[var(--color-border)] align-top">
                        <td className="px-4 py-3 sm:px-6">
                          <Link
                            href={`/dashboard/pipeline/${d.id}`}
                            className="font-medium hover:text-[var(--color-brand)]"
                          >
                            {d.name}
                          </Link>
                          <div className="mt-0.5 text-[11px] text-[var(--color-ink-faint)] sm:hidden">
                            {d.stage} - {d.dealType}
                          </div>
                          {d.notes && (
                            <div
                              className="mt-0.5 max-w-[20rem] truncate text-[11px] text-[var(--color-ink-faint)]"
                              title={d.notes}
                            >
                              {d.notes}
                            </div>
                          )}
                        </td>
                        <td className="hidden px-4 py-3 text-[var(--color-ink-muted)] sm:table-cell sm:px-6">
                          {d.stage}
                        </td>
                        <td className="hidden px-4 py-3 text-[var(--color-ink-muted)] md:table-cell sm:px-6">
                          {d.dealType}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums sm:px-6">
                          {resolved?.basis === "none" ? (
                            <span className="text-[var(--color-ink-faint)]">-</span>
                          ) : (
                            <>
                              {eur(value)}
                              {resolved && <ValueBasisNote basis={resolved.basis} />}
                            </>
                          )}
                        </td>
                        <td className="hidden px-4 py-3 tabular-nums text-[var(--color-ink-muted)] lg:table-cell sm:px-6">
                          {day(d.lastContact)}
                        </td>
                        <td className="px-4 py-3 text-right sm:px-6">
                          {d.outcome === "won" ? (
                            <Badge color="var(--color-mint)">Won</Badge>
                          ) : d.outcome === "lost" ? (
                            <Badge color="var(--color-rose)" className="opacity-70">
                              Lost
                            </Badge>
                          ) : (
                            <span className="text-xs text-[var(--color-ink-faint)]">Open</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </Reveal>

      {canReadProposals && (
        <Reveal>
          <CompanyProposals proposals={proposals} deals={dealChoices} canManage={canManageProposals} />
        </Reveal>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent: string;
}) {
  return (
    <div className="glass relative overflow-hidden p-4 sm:p-5">
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
      />
      <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">{label}</div>
      <div className="mt-2 font-display text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">{value}</div>
      {hint && <div className="mt-1 text-sm text-[var(--color-ink-muted)]">{hint}</div>}
    </div>
  );
}
