"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import type { Brand } from "@/lib/types";
import { outcomeOf } from "@/lib/lifecycle";
import { Badge } from "@/components/Badge";
import { BrandEditor } from "@/components/BrandEditor";
import { STATUS_TOKEN, PRIORITY_TOKEN, eur } from "@/lib/scoring";
import { PRIORITIES } from "@/lib/vocab";
import type { BrandStatus, Priority } from "@/lib/types";
import type { SavedView } from "@/lib/store/views";
import { createView, deleteView, type ViewActionState } from "@/app/actions/views";
import { ExportMenu } from "@/components/ExportMenu";
import type { Column } from "@/lib/export";
import type { LeadHealth } from "@/lib/pipeline/health";
import { useActionState } from "react";

type SortKey = "name" | "status" | "waitingOn" | "priority" | "owner" | "industry" | "budget" | "lastContact";
const SORT_KEYS: SortKey[] = ["name", "status", "waitingOn", "priority", "owner", "industry", "budget", "lastContact"];

/** The pipeline questions, as filters. Named for the work, not the lateness. */
const HEALTH_FILTERS = [
  { key: "all", label: "All" },
  { key: "lateOnUs", label: "To reply" },
  { key: "lateOnThem", label: "To follow up" },
  { key: "untriaged", label: "Needs an owner" },
  { key: "stale", label: "Gone quiet" },
] as const;
type HealthFilter = (typeof HEALTH_FILTERS)[number]["key"];

/**
 * Finished deals are noise in a view about what to do next, but hiding them
 * outright loses them. They stay one chip away.
 */
const LIFECYCLE_FILTERS = [
  { key: "active", label: "Active" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
  { key: "everything", label: "Everything" },
] as const;
type LifecycleFilter = (typeof LIFECYCLE_FILTERS)[number]["key"];

const matchesLifecycle = (b: Brand, f: LifecycleFilter): boolean => {
  if (f === "everything") return true;
  const outcome = outcomeOf(b.status);
  return f === "active" ? outcome === "open" : outcome === f;
};

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
  { key: "followUpDate", label: "Follow up" },
  { key: "waitingOn", label: "Waiting on" },
  { key: "nextStep", label: "Next step" },
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
    followUpDate: b.followUpDate,
    waitingOn: b.waitingOn ?? null,
    nextStep: b.nextStep ?? null,
    notes: b.notes,
  }));

export function BrandTable({
  brands,
  health = {},
  canDelete = false,
  views = [],
  commentCounts = {},
}: {
  brands: Brand[];
  health?: Record<string, LeadHealth>;
  canDelete?: boolean;
  views?: SavedView[];
  commentCounts?: Record<string, number>;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("All");
  const [owner, setOwner] = useState<string>("All");
  const [healthFilter, setHealthFilter] = useState<HealthFilter>("all");
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>("active");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  // undefined = closed - null = creating - Brand = editing
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
      const h = health[b.id];
      return (
        hay.includes(q.toLowerCase()) &&
        matchesLifecycle(b, lifecycle) &&
        (status === "All" || b.status === status) &&
        (owner === "All" || b.owner === owner) &&
        (healthFilter === "all" || !!h?.[healthFilter])
      );
    });
    r = [...r].sort((a, b) => {
      const get = (x: Brand) => {
        switch (sort.key) {
          case "budget": return x.scores?.budget ?? -1;
          case "lastContact": return x.lastContact ?? "";
          // Alphabetical would put Cold above Hot, so rank by the vocabulary's
          // own order; unset sorts last either way.
          case "priority": {
            const i = PRIORITIES.indexOf(x.priority as Priority);
            return i === -1 ? PRIORITIES.length : i;
          }
          // Ordered by who is blocked, then by how overdue, so the most urgent
          // rise together rather than being scattered through the side groups.
          case "waitingOn": {
            const h = health[x.id];
            const side = h?.waitingOn === "us" ? 0 : h?.waitingOn === "them" ? 1 : 2;
            return side * 100_000 - Math.min(h?.daysLate ?? 0, 99_999);
          }
          default: return (x[sort.key] ?? "") as string | number;
        }
      };
      const av = get(a), bv = get(b);
      return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
    });
    return r;
  }, [brands, health, q, status, owner, healthFilter, lifecycle, sort]);

  // Leads the Show filter is holding back that match everything else the user
  // typed. Without this, searching a client who happens to be won or lost
  // returns an empty table and no reason why.
  const hiddenByLifecycle = useMemo(() => {
    if (lifecycle === "everything") return 0;
    return brands.filter((b) => {
      const hay = `${b.name} ${b.poc ?? ""} ${b.notes ?? ""} ${b.industry ?? ""}`.toLowerCase();
      const h = health[b.id];
      return (
        !matchesLifecycle(b, lifecycle) &&
        hay.includes(q.toLowerCase()) &&
        (status === "All" || b.status === status) &&
        (owner === "All" || b.owner === owner) &&
        (healthFilter === "all" || !!h?.[healthFilter])
      );
    }).length;
  }, [brands, health, q, status, owner, healthFilter, lifecycle]);

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

      {/* what to show at all - finished deals are noise here, not gone */}
      <div data-tour="pipe-lifecycle" className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">Show</span>
        {LIFECYCLE_FILTERS.map((f) => {
          const count = brands.filter((b) => matchesLifecycle(b, f.key)).length;
          const active = lifecycle === f.key;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={active}
              onClick={() => setLifecycle(f.key)}
              className={clsx(
                "rounded-full border px-3 py-0.5 text-xs transition-colors",
                active
                  ? "border-[var(--color-brand)] bg-[var(--color-brand)]/10 text-[var(--color-ink)]"
                  : "border-[var(--color-border-strong)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]",
              )}
            >
              {f.label} <span className="tabular-nums text-[var(--color-ink-faint)]">{count}</span>
            </button>
          );
        })}
      </div>

      {/* health filters - the two questions the pipeline view exists to answer */}
      <div data-tour="pipe-health" className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">Health</span>
        {HEALTH_FILTERS.map((f) => {
          // Counted within what is on screen, so the chip cannot promise rows
          // the lifecycle filter is hiding.
          const inScope = brands.filter((b) => matchesLifecycle(b, lifecycle));
          const count = f.key === "all" ? inScope.length : inScope.filter((b) => health[b.id]?.[f.key]).length;
          const active = healthFilter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={active}
              onClick={() => setHealthFilter(f.key)}
              className={clsx(
                "rounded-full border px-3 py-0.5 text-xs transition-colors",
                active
                  ? "border-[var(--color-brand)] bg-[var(--color-brand)]/10 text-[var(--color-ink)]"
                  : "border-[var(--color-border-strong)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]",
              )}
            >
              {f.label} <span className="tabular-nums text-[var(--color-ink-faint)]">{count}</span>
            </button>
          );
        })}
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

      {hiddenByLifecycle > 0 && q.trim() !== "" && (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-[var(--color-ink-muted)]">
          {hiddenByLifecycle} finished {hiddenByLifecycle === 1 ? "deal also matches" : "deals also match"}{" "}
          <span className="text-[var(--color-ink)]">“{q}”</span>.
          <button
            type="button"
            onClick={() => setLifecycle("everything")}
            className="rounded-full border border-[var(--color-border-strong)] px-2.5 py-0.5 text-xs text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-ink)]"
          >
            Show everything
          </button>
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-surface)]">
            <tr>
              {th("name", "Brand")}
              {th("status", "Status")}
              {th("waitingOn", "Waiting on")}
              {th("priority", "Priority", "hidden sm:table-cell")}              {th("owner", "Owner", "hidden lg:table-cell")}
              {th("industry", "Industry", "hidden md:table-cell")}
              {th("budget", "Budget", "hidden text-right sm:table-cell")}
              {th("lastContact", "Last contact", "hidden xl:table-cell")}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-12 text-center">
                  <p className="text-sm text-[var(--color-ink-muted)]">
                    {brands.length === 0
                      ? "No leads yet - add your first one to start building the pipeline."
                      : hiddenByLifecycle > 0
                        ? `No active lead matches, but ${hiddenByLifecycle} finished ${hiddenByLifecycle === 1 ? "one does" : "ones do"}.`
                        : "No leads match your filters."}
                  </p>
                  {brands.length > 0 && hiddenByLifecycle > 0 && (
                    <button
                      onClick={() => setLifecycle("everything")}
                      className="mt-3 rounded-full border border-[var(--color-border-strong)] px-4 py-1.5 text-sm text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-ink)]"
                    >
                      Show everything
                    </button>
                  )}
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
                  {commentCounts[b.id] ? (
                    <span
                      className="ml-2 align-middle text-xs text-[var(--color-ink-faint)]"
                      title={`${commentCounts[b.id]} comment${commentCounts[b.id] === 1 ? "" : "s"}`}
                    >
                      &#9679; {commentCounts[b.id]}
                    </span>
                  ) : null}
                  {b.notes && (
                    <span
                      className="mt-0.5 block max-w-[22rem] truncate text-xs font-normal text-[var(--color-ink-faint)]"
                      title={b.notes}
                    >
                      {b.notes}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {b.status && <Badge color={STATUS_TOKEN[b.status as BrandStatus]}>{b.status}</Badge>}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <WaitingCell health={health[b.id]} />
                </td>
                <td className="hidden px-3 py-2 sm:table-cell">
                  {b.priority && <Badge color={PRIORITY_TOKEN[b.priority as Priority]}>{b.priority.replace(" Lead", "")}</Badge>}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-[var(--color-ink-muted)] lg:table-cell">{b.owner ?? "-"}</td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-[var(--color-ink-muted)] md:table-cell">{b.industry ?? "-"}</td>
                <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">
                  {b.scores?.budget ? eur(b.scores.budget) : "-"}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-[var(--color-ink-muted)] xl:table-cell">{b.lastContact ?? "-"}</td>
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

/**
 * Who owes the next move, and how late they are.
 *
 * "Waiting" and "late" are shown as one cell because the side alone is not
 * actionable - it is the overdue days that turn it into a to-do.
 *
 * A side nobody stated is marked as inferred. It used to render identically to
 * a stated one, so a lead whose "waiting on" was literally "not decided" still
 * announced "Us, 142 days late" with nothing on the page to say why.
 */
function WaitingCell({ health }: { health?: LeadHealth }) {
  if (!health || !health.waitingOn) {
    return <span className="text-xs text-[var(--color-ink-faint)]">-</span>;
  }
  const onUs = health.waitingOn === "us";
  const late = health.daysLate > 0;
  const inferred = health.source !== "explicit";
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge color={onUs ? "var(--color-brand)" : "var(--color-ink-faint)"}>{onUs ? "Us" : "Them"}</Badge>
      {inferred && (
        <span
          title={WAITING_REASON[health.source]}
          className="cursor-help text-xs text-[var(--color-ink-faint)]"
          aria-label="inferred"
        >
          ?
        </span>
      )}
      {late && (
        <span
          className="text-xs font-medium tabular-nums"
          style={{ color: onUs ? "var(--color-rose)" : "var(--color-amber)" }}
        >
          {health.daysLate}d late
        </span>
      )}
    </span>
  );
}

export const WAITING_REASON: Record<LeadHealth["source"], string> = {
  explicit: "Someone set this on the lead.",
  proposal:
    "Inferred: a proposal is out for decision, so the ball is with them. Nobody has set this on the lead.",
  followUp:
    "Inferred: the lead has a follow-up date but nobody has said who owes the next move, so it is taken as ours. Set “Waiting on” to say otherwise.",
  none: "Nobody has said, and there is no follow-up date or open proposal to infer it from.",
};

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {  return (
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
