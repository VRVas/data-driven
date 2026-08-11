"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import type { Brand } from "@/lib/types";
import { Badge } from "@/components/Badge";
import { BrandEditor } from "@/components/BrandEditor";
import { STATUS_TOKEN, PRIORITY_TOKEN, eur } from "@/lib/scoring";
import type { BrandStatus, Priority } from "@/lib/types";
import type { SavedView } from "@/lib/store/views";
import { createView, deleteView, type ViewActionState } from "@/app/actions/views";
import { ExportMenu } from "@/components/ExportMenu";
import type { Column } from "@/lib/export";
import { useActionState } from "react";

type SortKey = "name" | "status" | "owner" | "industry" | "budget" | "lastContact";
const SORT_KEYS: SortKey[] = ["name", "status", "owner", "industry", "budget", "lastContact"];

const PIPE_COLS: Column[] = [
  { key: "name", label: "Brand" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "owner", label: "Owner" },
  { key: "poc", label: "POC" },
  { key: "email", label: "Email" },
  { key: "industry", label: "Industry" },
  { key: "budget", label: "Budget (EUR)" },
  { key: "initialContact", label: "Initial contact" },
  { key: "lastContact", label: "Last contact" },
  { key: "followUp", label: "Follow up" },
  { key: "notes", label: "Notes" },
];
const pipeRows = (list: Brand[]): Record<string, unknown>[] =>
  list.map((b) => ({
    name: b.name,
    status: b.status,
    priority: b.priority,
    owner: b.owner,
    poc: b.poc,
    email: b.email,
    industry: b.industry,
    budget: b.scores?.budget ?? null,
    initialContact: b.initialContact,
    lastContact: b.lastContact,
    followUp: b.followUp,
    notes: b.notes,
  }));

export function BrandTable({
  brands,
  canDelete = false,
  views = [],
}: {
  brands: Brand[];
  canDelete?: boolean;
  views?: SavedView[];
}) {
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

  const applyView = (v: SavedView) => {
    setQ(v.q ?? "");
    setStatus(v.status ?? "All");
    setOwner(v.owner ?? "All");
    const key = SORT_KEYS.includes(v.sortKey as SortKey) ? (v.sortKey as SortKey) : "name";
    setSort({ key, dir: v.sortDir === -1 ? -1 : 1 });
  };

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
      {/* saved views */}
      <div data-tour="pipe-views" className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">Views</span>
        {views.length === 0 && <span className="text-xs text-[var(--color-ink-faint)]">none saved</span>}
        {views.map((v) => (
          <span
            key={v.id}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border-strong)] py-0.5 pl-3 pr-1 text-xs"
          >
            <button onClick={() => applyView(v)} className="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
              {v.name}
            </button>
            <DeleteViewButton id={v.id} />
          </span>
        ))}
        <SaveViewForm q={q} status={status} owner={owner} sortKey={sort.key} sortDir={sort.dir} />
      </div>

      {/* controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search brand, POC, notes…"
          data-tour="pipe-search"
          className="h-9 w-64 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm outline-none focus:border-[var(--color-brand)]"
        />
        <Select label="Status" value={status} onChange={setStatus} options={statuses} />
        <Select label="Owner" value={owner} onChange={setOwner} options={owners} />
        <button
          onClick={() => setEditing(null)}
          data-tour="pipe-newlead"
          className="ml-auto rounded-full bg-[var(--color-brand)] px-4 py-1.5 text-sm font-semibold text-white transition-transform hover:scale-[1.03]"
        >
          + New lead
        </button>
        <span data-tour="pipe-export">
          <ExportMenu filename="pipeline" columns={PIPE_COLS} rows={pipeRows(rows)} allRows={pipeRows(brands)} size="sm" />
        </span>
        <span className="text-sm text-[var(--color-ink-muted)]">{rows.length} of {brands.length}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-surface)]">
            <tr>
              {th("name", "Brand")}
              {th("status", "Status")}
              <th className="hidden px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)] sm:table-cell">Priority</th>
              {th("owner", "Owner", "hidden lg:table-cell")}
              {th("industry", "Industry", "hidden md:table-cell")}
              {th("budget", "Budget", "hidden text-right sm:table-cell")}
              {th("lastContact", "Last contact", "hidden xl:table-cell")}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center">
                  <p className="text-sm text-[var(--color-ink-muted)]">
                    {brands.length === 0
                      ? "No leads yet — add your first one to start building the pipeline."
                      : "No leads match your filters."}
                  </p>
                  {brands.length === 0 && (
                    <button
                      onClick={() => setEditing(null)}
                      className="mt-3 rounded-full bg-[var(--color-brand)] px-4 py-1.5 text-sm font-semibold text-white transition-transform hover:scale-[1.03]"
                    >
                      + Add your first lead
                    </button>
                  )}
                </td>
              </tr>
            )}
            {rows.map((b, i) => (
              <tr key={b.id} id={b.id} className="border-t border-[var(--color-border)] transition-colors hover:bg-[var(--color-surface)]/60">
                <td className="px-3 py-2 font-medium">
                  <Link href={`/dashboard/pipeline/${b.id}`} className="hover:text-[var(--color-brand-bright)] hover:underline">
                    {b.name}
                  </Link>
                  {!b.scored && <span className="ml-2 text-xs text-[var(--color-ink-faint)]">unscored</span>}
                </td>
                <td className="px-3 py-2">
                  {b.status && <Badge color={STATUS_TOKEN[b.status as BrandStatus]}>{b.status}</Badge>}
                </td>
                <td className="hidden px-3 py-2 sm:table-cell">
                  {b.priority && <Badge color={PRIORITY_TOKEN[b.priority as Priority]}>{b.priority.replace(" Lead", "")}</Badge>}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-[var(--color-ink-muted)] lg:table-cell">{b.owner ?? "—"}</td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-[var(--color-ink-muted)] md:table-cell">{b.industry ?? "—"}</td>
                <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">
                  {b.scores?.budget ? eur(b.scores.budget) : "—"}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-[var(--color-ink-muted)] xl:table-cell">{b.lastContact ?? "—"}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => setEditing(b)}
                    data-tour={i === 0 ? "pipe-edit" : undefined}
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
        <BrandEditor brand={editing} onClose={() => setEditing(undefined)} canDelete={canDelete} />
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

function SaveViewForm({
  q,
  status,
  owner,
  sortKey,
  sortDir,
}: {
  q: string;
  status: string;
  owner: string;
  sortKey: string;
  sortDir: 1 | -1;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ViewActionState, FormData>(createView, undefined);
  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-full border border-dashed border-[var(--color-border-strong)] px-3 py-0.5 text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
      >
        + Save view
      </button>
    );
  }
  return (
    <form action={action} className="inline-flex items-center gap-1">
      <input type="hidden" name="q" value={q} />
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="owner" value={owner} />
      <input type="hidden" name="sortKey" value={sortKey} />
      <input type="hidden" name="sortDir" value={sortDir} />
      <input
        name="name"
        autoFocus
        placeholder="View name"
        className="h-7 w-28 rounded-full border border-[var(--color-border-strong)] bg-transparent px-3 text-xs outline-none focus:border-[var(--color-brand)]"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-[var(--color-brand)] px-3 py-1 text-xs font-medium text-white disabled:opacity-60"
      >
        {pending ? "…" : "Save"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="px-1 text-xs text-[var(--color-ink-faint)]">
        ✕
      </button>
    </form>
  );
}

function DeleteViewButton({ id }: { id: string }) {
  const [, action, pending] = useActionState<ViewActionState, FormData>(deleteView, undefined);
  return (
    <form action={action} className="inline-flex">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        aria-label="Delete view"
        className="grid h-4 w-4 place-items-center rounded-full text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-rose)]"
      >
        ✕
      </button>
    </form>
  );
}
