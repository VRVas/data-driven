"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { eur } from "@/lib/scoring";
import type { CompanyRollup } from "@/lib/crm/types";

export interface CompanyRow {
  id: string;
  name: string;
  industry: string | null;
  rollup: CompanyRollup;
}

type SortKey = "name" | "industry" | "deals" | "open" | "lifetime" | "repeat";

function dealSummary(r: CompanyRollup): string {
  const parts: string[] = [];
  if (r.openDealCount) parts.push(`${r.openDealCount} open`);
  if (r.wonDealCount) parts.push(`${r.wonDealCount} won`);
  if (r.lostDealCount) parts.push(`${r.lostDealCount} lost`);
  return parts.join(" - ") || "-";
}

export function CompanyTable({ companies }: { companies: CompanyRow[] }) {
  // Money descending first: the useful default is "who is worth the most", not
  // alphabetical.
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "open", dir: -1 });
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const value = (c: CompanyRow): string | number => {
      switch (sort.key) {
        case "name": return c.name.toLowerCase();
        case "industry": return (c.industry ?? "").toLowerCase();
        // Total deals, so the column sorts by the same thing it displays.
        case "deals": return c.rollup.openDealCount + c.rollup.wonDealCount + c.rollup.lostDealCount;
        case "open": return c.rollup.openPipelineValue;
        case "lifetime": return c.rollup.lifetimeValue;
        case "repeat": return c.rollup.repeatValue;
      }
    };
    const needle = q.trim().toLowerCase();
    return companies
      .filter((c) => !needle || `${c.name} ${c.industry ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        const av = value(a), bv = value(b);
        return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
      });
  }, [companies, sort, q]);

  // Text sorts read best A→Z first; money reads best biggest-first.
  const toggle = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 1 ? -1 : 1 }
        : { key, dir: key === "name" || key === "industry" ? 1 : -1 },
    );

  const th = (key: SortKey, label: string, extra?: string) => (
    <th
      aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
      className={clsx("eyebrow px-4 py-3 sm:px-6", extra)}
    >
      <button
        type="button"
        onClick={() => toggle(key)}
        className="inline-flex cursor-pointer select-none items-center gap-1 uppercase tracking-wider hover:text-[var(--color-ink)]"
      >
        {label}
        {sort.key === key && <span aria-hidden>{sort.dir === 1 ? "↑" : "↓"}</span>}
      </button>
    </th>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-4 py-3 sm:px-6">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search companies…"
          aria-label="Search companies"
          className="h-9 w-64 max-w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm outline-none focus:border-[var(--color-brand)]"
        />
        <span className="text-sm text-[var(--color-ink-muted)]">
          {rows.length} of {companies.length}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
        <thead className="border-b border-[var(--color-border)]">
          <tr className="text-left">
            {th("name", "Company")}
            {th("industry", "Industry", "hidden sm:table-cell")}
            {th("deals", "Deals")}
            {th("open", "Open pipeline", "text-right")}
            {th("lifetime", "Lifetime", "hidden text-right md:table-cell")}
            {th("repeat", "Repeat", "hidden text-right lg:table-cell")}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
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
                {c.industry ?? "-"}
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
                  <span className="text-[var(--color-ink-faint)]">-</span>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center text-sm text-[var(--color-ink-muted)] sm:px-6">
                No company matches “{q}”.
              </td>
            </tr>
          )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
