"use client";

import { useMemo, useState } from "react";
import { ProposalDrawer } from "@/components/crm/ProposalDrawer";
import { ProposalStatusPill } from "@/components/crm/ProposalStatusPill";
import { eur } from "@/lib/scoring";
import type { Proposal } from "@/lib/crm/types";

const day = (v: string | null): string => (v ? v.slice(0, 10) : "—");

export function CompanyProposals({
  proposals,
  deals,
  canManage,
}: {
  proposals: Proposal[];
  deals: Array<{ id: string; name: string }>;
  canManage: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Proposal | null>(null);

  const dealNames = useMemo(() => new Map(deals.map((d) => [d.id, d.name])), [deals]);
  const rows = useMemo(
    () =>
      // Compared by day: sentAt comes from a date input, createdAt is a full
      // ISO stamp, and comparing them raw puts a same-day sentAt first.
      [...proposals].sort(
        (a, b) =>
          (b.sentAt ?? b.createdAt).slice(0, 10).localeCompare((a.sentAt ?? a.createdAt).slice(0, 10)) ||
          b.revision - a.revision,
      ),
    [proposals],
  );

  return (
    <section className="glass overflow-hidden">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--color-border)] px-4 py-4 sm:px-6">
        <div>
          <div className="eyebrow mb-1">Commercials</div>
          <h2 className="font-display text-xl font-semibold tracking-tight">Proposals</h2>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Every number that left the building, and what came back.
          </p>
        </div>
        {canManage && deals.length > 0 && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-full bg-[var(--color-brand)] px-4 py-1.5 text-sm font-semibold text-white"
          >
            New proposal
          </button>
        )}
      </header>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-[var(--color-ink-muted)] sm:px-6">
          No proposals yet.{" "}
          {deals.length === 0
            ? "There are no deals here to quote for."
            : "Add one and the awaiting-decision figure starts counting it."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)]">
              <tr className="text-left">
                <th className="eyebrow px-4 py-3 sm:px-6">Deal</th>
                <th className="eyebrow hidden px-4 py-3 sm:table-cell sm:px-6">Rev</th>
                <th className="eyebrow px-4 py-3 text-right sm:px-6">Value</th>
                <th className="eyebrow px-4 py-3 sm:px-6">Status</th>
                <th className="eyebrow hidden px-4 py-3 md:table-cell sm:px-6">Sent</th>
                <th className="eyebrow hidden px-4 py-3 lg:table-cell sm:px-6">Decided</th>
                {canManage && <th className="eyebrow px-4 py-3 text-right sm:px-6">Edit</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-[var(--color-border)] align-top">
                  <td className="px-4 py-3 sm:px-6">
                    <div className="font-medium">{dealNames.get(p.dealId) ?? p.dealId}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-[var(--color-ink-faint)] sm:hidden">
                      v{p.revision} · {day(p.sentAt)}
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 font-mono text-xs text-[var(--color-ink-muted)] sm:table-cell sm:px-6">
                    v{p.revision}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums sm:px-6">{eur(p.value)}</td>
                  <td className="px-4 py-3 sm:px-6">
                    <ProposalStatusPill status={p.status} />
                  </td>
                  <td className="hidden px-4 py-3 tabular-nums text-[var(--color-ink-muted)] md:table-cell sm:px-6">
                    {day(p.sentAt)}
                  </td>
                  <td className="hidden px-4 py-3 tabular-nums text-[var(--color-ink-muted)] lg:table-cell sm:px-6">
                    {day(p.decidedAt)}
                  </td>
                  {canManage && (
                    <td className="px-4 py-3 text-right sm:px-6">
                      <button
                        type="button"
                        onClick={() => setEditing(p)}
                        className="rounded-full border border-[var(--color-border-strong)] px-3 py-1.5 text-sm hover:border-[var(--color-brand)]"
                      >
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && deals.length > 0 && (
        <ProposalDrawer proposal={null} dealId={deals[0].id} deals={deals} onClose={() => setCreating(false)} />
      )}
      {editing && (
        <ProposalDrawer
          proposal={editing}
          dealId={editing.dealId}
          deals={deals}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
