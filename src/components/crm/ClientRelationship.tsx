import Link from "next/link";
import { Badge } from "@/components/Badge";
import { NewDealButton } from "@/components/crm/NewDealButton";
import { ValueBasisNote } from "@/components/crm/ValueBasisNote";
import { dealValue } from "@/lib/crm/logic";
import type { Company, Deal, Proposal } from "@/lib/crm/types";
import { eur } from "@/lib/scoring";

const OUTCOME_ORDER: Record<Deal["outcome"], number> = { open: 0, won: 1, lost: 2 };

const day = (v: string | null): string => (v ? v.slice(0, 10) : "-");

/**
 * The client behind a lead: what the relationship has earned, and every other
 * piece of work under the same name.
 *
 * This used to be its own page at /dashboard/companies/[id], which meant
 * clicking "Alibaba" in the pipeline and clicking "Alibaba" in the companies
 * list landed you on two different screens showing overlapping facts. It is one
 * screen now, and this is the half that came across.
 *
 * `currentDealId` is the lead you are already looking at - it stays in the table
 * so the row count matches the deal count, but it does not link to itself.
 */
export function ClientRelationship({
  company,
  deals: unsorted,
  proposals,
  currentDealId,
  canCreateLeads,
}: {
  company: Company;
  deals: Deal[];
  proposals: Proposal[];
  currentDealId: string;
  canCreateLeads: boolean;
}) {
  const rollup = company.rollup;
  const deals = [...unsorted].sort(
    (a, b) =>
      OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome] ||
      (b.wonValue ?? dealValue(b, proposals).value) - (a.wonValue ?? dealValue(a, proposals).value),
  );

  // "EUR 0" is a claim, and these figures are zero for two very different
  // reasons: nothing has happened yet, or it has happened and nobody recorded
  // what it was worth. The lead's own Expected value card already draws this
  // distinction; the rollups have to draw it too, or a client we have never
  // billed reads as a client worth nothing.
  const money = (value: number, has: boolean, why: string) =>
    !has || value === 0 ? { value: "-", hint: why } : { value: eur(value), hint: undefined as string | undefined };

  const lifetime = money(rollup.lifetimeValue, rollup.wonDealCount > 0, rollup.wonDealCount === 0 ? "nothing won yet" : "no value recorded on the wins");
  const repeat = money(rollup.repeatValue, rollup.wonDealCount > 1, rollup.wonDealCount > 1 ? "no value beyond the first win" : "needs a second win");
  const open = money(rollup.openPipelineValue, rollup.openDealCount > 0, rollup.openDealCount === 0 ? "no open deals" : "no values set yet");

  return (
    <section className="glass overflow-hidden">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--color-border)] px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold tracking-tight">{company.name}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {company.industry && <Badge>{company.industry}</Badge>}
            {company.owner && <Badge color="var(--color-cyan)">{company.owner}</Badge>}
            <span className="text-xs text-[var(--color-ink-faint)]">
              {deals.length} {deals.length === 1 ? "deal" : "deals"} with this client
            </span>
          </div>
        </div>
        {canCreateLeads && <NewDealButton company={{ id: company.id, name: company.name }} />}
      </header>

      <dl className="grid grid-cols-2 gap-px border-b border-[var(--color-border)] bg-[var(--color-border)] lg:grid-cols-4">
        <Rollup label="Lifetime value" value={lifetime.value} hint={lifetime.hint} accent="var(--color-brand)" />
        <Rollup
          label="Repeat value"
          value={repeat.value}
          hint={repeat.hint ?? "won beyond the first deal"}
          accent="var(--color-mint)"
        />
        <Rollup label="Open pipeline" value={open.value} hint={open.hint} accent="var(--color-amber)" />
        <Rollup
          label="Deal win rate"
          value={rollup.dealWinRate == null ? "-" : `${Math.round(rollup.dealWinRate * 100)}%`}
          hint={rollup.dealWinRate == null ? "nothing decided yet" : "of decided deals"}
          accent="var(--color-cyan)"
        />
      </dl>

      {deals.length === 0 ? (
        <p className="px-4 py-6 text-sm text-[var(--color-ink-muted)] sm:px-6">
          No deals under this client yet.
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
                const isCurrent = d.id === currentDealId;
                return (
                  <tr
                    key={d.id}
                    className="border-t border-[var(--color-border)] align-top"
                    style={isCurrent ? { background: "color-mix(in srgb, var(--color-brand) 7%, transparent)" } : undefined}
                  >
                    <td className="px-4 py-3 sm:px-6">
                      {isCurrent ? (
                        <span className="font-medium">
                          {d.name}
                          <span className="ml-2 text-[11px] text-[var(--color-ink-faint)]">this lead</span>
                        </span>
                      ) : (
                        <Link href={`/dashboard/pipeline/${d.id}`} className="font-medium hover:text-[var(--color-brand)]">
                          {d.name}
                        </Link>
                      )}
                      <div className="mt-0.5 text-[11px] text-[var(--color-ink-faint)] sm:hidden">
                        {d.stage} - {d.dealType}
                      </div>
                      {d.notes && (
                        <div className="mt-0.5 max-w-[20rem] truncate text-[11px] text-[var(--color-ink-faint)]" title={d.notes}>
                          {d.notes}
                        </div>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 text-[var(--color-ink-muted)] sm:table-cell sm:px-6">{d.stage}</td>
                    <td className="hidden px-4 py-3 text-[var(--color-ink-muted)] md:table-cell sm:px-6">{d.dealType}</td>
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
  );
}

function Rollup({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent: string }) {
  return (
    <div className="relative overflow-hidden bg-[var(--color-bg-elevated)] p-4 sm:p-5">
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
      <dt className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">{label}</dt>
      <dd className="mt-2 font-display text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">{value}</dd>
      {hint && <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{hint}</p>}
    </div>
  );
}
