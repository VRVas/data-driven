"use client";

import { useMemo, useState } from "react";
import { clsx } from "clsx";
import type { Brand } from "@/lib/types";
import { Badge } from "@/components/Badge";
import { BrandEditor } from "@/components/BrandEditor";
import { STATUS_TOKEN, PRIORITY_TOKEN, eur } from "@/lib/scoring";
import type { BrandStatus, Priority } from "@/lib/types";

type SortKey = "name" | "status" | "owner" | "industry" | "budget" | "lastContact";

export function BrandTable({ brands }: { brands: Brand[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("All");
  const [owner, setOwner] = useState<string>("All");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  // undefined = closed · null = creating · Brand = editing
  const [editing, setEditing] = useState<Brand | null | undefined>(undefined);

  const owners = useMemo(
    () => ["All", ...Array.from(new Set(brands.map((b) => b.owner).filter(Boolean))) as string[]],
    [brands],
  );
  const statuses = useMemo(
    () => ["All", ...Array.from(new Set(brands.map((b) => b.status).filter(Boolean))) as string[]],
    [brands],
  );

  const rows = useMemo(() => {
    let r = brands.filter((b) => {
      const hay = `${b.name} ${b.poc ?? ""} ${b.notes ?? ""} ${b.industry ?? ""}`.toLowerCase();
      return (
        hay.includes(q.toLowerCase()) &&
        (status === "All" || b.status === status) &&
        (owner === "All" || b.owner === owner)
      );
    });
    r = [...r].sort((a, b) => {
      const get = (x: Brand) => {
        switch (sort.key) {
          case "budget": return x.scores?.budget ?? -1;
          case "lastContact": return x.lastContact ?? "";
          default: return (x[sort.key] ?? "") as string | number;
        }
      };
      const av = get(a), bv = get(b);
      return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
    });
    return r;
  }, [brands, q, status, owner, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === 1 ? -1 : 1 }));

  const th = (key: SortKey, label: string, extra?: string) => (
    <th
      onClick={() => toggleSort(key)}
      className={clsx(
        "cursor-pointer select-none px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]",
        extra,
      )}
    >
      {label}
      {sort.key === key && <span className="ml-1">{sort.dir === 1 ? "↑" : "↓"}</span>}
    </th>
  );

  return (
    <div>
      {/* controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search brand, POC, notes…"
          className="h-9 w-64 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm outline-none focus:border-[var(--color-brand)]"
        />
        <Select label="Status" value={status} onChange={setStatus} options={statuses} />
        <Select label="Owner" value={owner} onChange={setOwner} options={owners} />
        <button
          onClick={() => setEditing(null)}
          className="ml-auto rounded-full bg-[var(--color-brand)] px-4 py-1.5 text-sm font-semibold text-white transition-transform hover:scale-[1.03]"
        >
          + New lead
        </button>
        <span className="text-sm text-[var(--color-ink-muted)]">{rows.length} of {brands.length}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-surface)]">
            <tr>
              {th("name", "Brand")}
              {th("status", "Status")}
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">Priority</th>
              {th("owner", "Owner")}
              {th("industry", "Industry")}
              {th("budget", "Budget", "text-right")}
              {th("lastContact", "Last contact")}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} id={b.id} className="border-t border-[var(--color-border)] transition-colors hover:bg-[var(--color-surface)]/60">
                <td className="px-3 py-2 font-medium">
                  {b.name}
                  {!b.scored && <span className="ml-2 text-xs text-[var(--color-ink-faint)]">unscored</span>}
                </td>
                <td className="px-3 py-2">
                  {b.status && <Badge color={STATUS_TOKEN[b.status as BrandStatus]}>{b.status}</Badge>}
                </td>
                <td className="px-3 py-2">
                  {b.priority && <Badge color={PRIORITY_TOKEN[b.priority as Priority]}>{b.priority.replace(" Lead", "")}</Badge>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-[var(--color-ink-muted)]">{b.owner ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-[var(--color-ink-muted)]">{b.industry ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {b.scores?.budget ? eur(b.scores.budget) : "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-[var(--color-ink-muted)]">{b.lastContact ?? "—"}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => setEditing(b)}
                    className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-ink)]"
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing !== undefined && (
        <BrandEditor brand={editing} onClose={() => setEditing(undefined)} />
      )}
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-brand)]"
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}
