"use client";

import Link from "next/link";
import type { Block, LeadCardData, ActionSpec } from "@/lib/copilot/blocks";
import { toneVar } from "@/lib/copilot/blocks";
import { tableBlockToCsv } from "@/lib/copilot/serialize";
import { copyText } from "@/lib/download";
import { useToast } from "@/components/ui/Toast";
import { CopilotChart } from "./CopilotChart";

/** Render a composed list of blocks. `onAction` handles interactive action blocks. */
export function BlockRenderer({
  blocks,
  onAction,
  pendingAction,
}: {
  blocks: Block[];
  onAction?: (a: ActionSpec) => void;
  pendingAction?: string | null;
}) {
  return (
    <div className="space-y-3.5">
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} onAction={onAction} pendingAction={pendingAction} />
      ))}
    </div>
  );
}

function BlockView({
  block,
  onAction,
  pendingAction,
}: {
  block: Block;
  onAction?: (a: ActionSpec) => void;
  pendingAction?: string | null;
}) {
  switch (block.type) {
    case "heading":
      return (
        <div>
          <h3 className="font-display text-lg font-semibold tracking-tight text-[var(--color-ink)]">{block.title}</h3>
          {block.subtitle && <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">{block.subtitle}</p>}
        </div>
      );
    case "text":
      return <RichText text={block.text} />;
    case "reasoning":
      return <Reasoning text={block.text} />;
    case "callout":
      return <Callout tone={block.tone} title={block.title} text={block.text} />;
    case "divider":
      return <div className="h-px bg-[var(--color-border)]" />;
    case "metrics":
      return <Metrics items={block.items} />;
    case "table":
      return <TableBlock block={block} />;
    case "keyValue":
      return (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {block.items.map((it, i) => (
            <div key={i} className="flex justify-between gap-3 border-b border-[var(--color-border)] pb-1.5">
              <dt className="text-[var(--color-ink-faint)]">{it.label}</dt>
              <dd className="tabular-nums text-[var(--color-ink)]">{String(it.value)}</dd>
            </div>
          ))}
        </dl>
      );
    case "list":
      return <ListBlock style={block.style} items={block.items} />;
    case "badges":
      return (
        <div className="flex flex-wrap gap-1.5">
          {block.items.map((it, i) => (
            <span
              key={i}
              className="rounded-full border px-2.5 py-0.5 text-xs"
              style={{ color: toneVar(it.tone), borderColor: `color-mix(in srgb, ${toneVar(it.tone)} 45%, transparent)` }}
            >
              {it.label}
            </span>
          ))}
        </div>
      );
    case "chart":
      return <CopilotChart block={block} />;
    case "leadCard":
      return <LeadCard lead={block} />;
    case "leadGrid":
      return (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {block.leads.map((l, i) => (
            <LeadCard key={i} lead={l} />
          ))}
        </div>
      );
    case "companyCard":
      return <CompanyCard company={block} />;
    case "scoreBreakdown":
      return <ScoreBreakdown block={block} />;
    case "comparison":
      return <Comparison items={block.items} />;
    case "recommendation":
      return <Recommendation title={block.title} rationale={block.rationale} confidence={block.confidence} />;
    case "timeline":
      return <Timeline events={block.events} />;
    case "actions":
      return <ActionsBar actions={block.actions} onAction={onAction} pendingAction={pendingAction} />;
    case "sources":
      return <Sources title={block.title} items={block.items} />;
    default:
      return null;
  }
}

/** Minimal markdown: **bold** and `- ` bullets. */
export function RichText({ text }: { text: string }) {
  const bold = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i} className="font-semibold text-[var(--color-ink)]">{part.slice(2, -2)}</strong>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
  return (
    <div className="space-y-1 text-sm leading-relaxed text-[var(--color-ink-muted)]">
      {text.split("\n").map((ln, i) =>
        ln.startsWith("- ") ? (
          <div key={i} className="flex gap-2">
            <span className="text-[var(--color-brand)]">•</span>
            <span>{bold(ln.slice(2))}</span>
          </div>
        ) : ln.trim() === "" ? (
          <div key={i} className="h-1" />
        ) : (
          <p key={i}>{bold(ln)}</p>
        ),
      )}
    </div>
  );
}

function Reasoning({ text }: { text: string }) {
  return (
    <details className="group rounded-xl border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-frosted-canvas)_2%,transparent)] px-4 py-2.5">
      <summary className="flex cursor-pointer items-center gap-2 text-xs text-[var(--color-ink-faint)]">
        <span className="font-mono uppercase tracking-[0.14em]">Reasoning</span>
        <span className="opacity-60 transition-opacity group-open:opacity-100">▸</span>
      </summary>
      <div className="mt-2 whitespace-pre-line text-xs leading-relaxed text-[var(--color-ink-muted)]">{text}</div>
    </details>
  );
}

function Callout({ tone, title, text }: { tone: string; title?: string | null; text: string }) {
  const c = toneVar(tone);
  return (
    <div
      className="rounded-xl border px-4 py-3"
      style={{ borderColor: `color-mix(in srgb, ${c} 40%, transparent)`, background: `color-mix(in srgb, ${c} 8%, transparent)` }}
    >
      {title && <div className="mb-0.5 text-sm font-semibold" style={{ color: c }}>{title}</div>}
      <div className="text-sm text-[var(--color-ink-muted)]"><RichText text={text} /></div>
    </div>
  );
}

function Sources({ title, items }: { title?: string | null; items: Extract<Block, { type: "sources" }>["items"] }) {
  const domain = (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  };
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-frosted-canvas)_2%,transparent)] px-4 py-3">
      <div className="eyebrow mb-2">{title ?? "Sources"}</div>
      <ol className="space-y-1.5">
        {items.map((s, i) => (
          <li key={i} className="flex gap-2 text-sm">
            {s.n != null && <span className="mt-px shrink-0 tabular-nums text-[var(--color-ink-faint)]">[{s.n}]</span>}
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex min-w-0 items-baseline gap-1.5 text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-brand)]"
            >
              <span className="truncate underline decoration-[var(--color-border)] underline-offset-2 group-hover:decoration-[var(--color-brand)]">
                {s.title}
              </span>
              <span className="shrink-0 text-xs text-[var(--color-ink-faint)]">{domain(s.url)} ↗</span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Metrics({ items }: { items: Extract<Block, { type: "metrics" }>["items"] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {items.map((it, i) => (
        <div key={i} className="glass relative overflow-hidden p-3.5">
          <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${toneVar(it.tone)}, transparent)` }} />
          <div className="eyebrow truncate">{it.label}</div>
          <div className="mt-1 font-display text-xl font-semibold tabular-nums text-[var(--color-ink)]">
            {String(it.value)}
            {it.unit && <span className="ml-0.5 text-xs text-[var(--color-ink-faint)]">{it.unit}</span>}
          </div>
          {it.delta != null && (
            <div className="mt-0.5 text-xs tabular-nums" style={{ color: it.delta >= 0 ? "var(--color-mint)" : "var(--color-rose)" }}>
              {it.delta >= 0 ? "▲" : "▼"} {Math.abs(it.delta)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function TableBlock({ block }: { block: Extract<Block, { type: "table" }> }) {
  const toast = useToast();
  const fmtCell = (v: string | number | null, kind?: string | null) => {
    if (v == null) return "-";
    if (kind === "currency" && typeof v === "number") return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
    if (kind === "percent" && typeof v === "number") return `${Math.round(v)}%`;
    return String(v);
  };
  const copyCsv = async () => {
    const ok = await copyText(tableBlockToCsv(block));
    toast(ok ? "Copied CSV" : "Copy failed", ok ? "success" : "error");
  };
  return (
    <div>
      <div className="mb-1 flex justify-end">
        <button
          onClick={copyCsv}
          className="rounded-full border border-[var(--color-border-strong)] px-2.5 py-0.5 text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
        >
          Copy CSV
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            {block.columns.map((c) => (
              <th key={c.key} className={`px-3 py-2 eyebrow ${c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left"}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, ri) => (
            <tr key={ri} className="border-t border-[var(--color-border)]">
              {block.columns.map((c) => {
                const v = row[c.key] ?? null;
                return (
                  <td key={c.key} className={`px-3 py-2 ${c.align === "right" ? "text-right tabular-nums" : c.align === "center" ? "text-center" : "text-left"} ${c.kind === "status" || c.kind === "badge" ? "" : "text-[var(--color-ink-muted)]"}`}>
                    {c.kind === "status" || c.kind === "badge" ? (
                      <span className="rounded-full border border-[var(--color-border-strong)] px-2 py-0.5 text-xs text-[var(--color-ink)]">{fmtCell(v, c.kind)}</span>
                    ) : (
                      fmtCell(v, c.kind)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {block.caption && <div className="px-3 py-2 text-xs text-[var(--color-ink-faint)]">{block.caption}</div>}
      </div>
    </div>
  );
}

function ListBlock({ style, items }: { style: string; items: string[] }) {
  return (
    <ul className="space-y-1.5 text-sm text-[var(--color-ink-muted)]">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="mt-0.5 shrink-0 text-[var(--color-brand)]">
            {style === "ordered" ? `${i + 1}.` : style === "check" ? "✓" : "•"}
          </span>
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

function scoreTone(score?: number | null): string {
  if (score == null) return "var(--color-ink-faint)";
  if (score >= 3.5) return "var(--color-mint)";
  if (score >= 2.5) return "var(--color-amber)";
  return "var(--color-rose)";
}

function LeadCard({ lead }: { lead: LeadCardData }) {
  const pct = lead.score != null ? (lead.score / 5) * 100 : 0;
  const ring = scoreTone(lead.score);
  return (
    <Link href={`/dashboard/pipeline/${lead.id}`} className="beam-card glass block p-4 transition-transform hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-display font-semibold text-[var(--color-ink)]">{lead.name}</div>
          <div className="mt-0.5 truncate text-xs text-[var(--color-ink-faint)]">
            {[lead.industry, lead.status].filter(Boolean).join(" - ") || "-"}
          </div>
        </div>
        {lead.score != null && (
          <div className="relative grid h-11 w-11 shrink-0 place-items-center">
            <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90">
              <circle cx="22" cy="22" r="18" fill="none" stroke="var(--color-border)" strokeWidth="4" />
              <circle cx="22" cy="22" r="18" fill="none" stroke={ring} strokeWidth="4" strokeLinecap="round"
                strokeDasharray={`${(pct / 100) * 113} 113`} />
            </svg>
            <span className="text-xs font-semibold tabular-nums" style={{ color: ring }}>{lead.score.toFixed(1)}</span>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {lead.priority && <span className="rounded-full border border-[var(--color-border-strong)] px-2 py-0.5 text-[var(--color-ink-muted)]">{lead.priority}</span>}
        {lead.quadrant && <span className="rounded-full border border-[var(--color-border-strong)] px-2 py-0.5 text-[var(--color-ink-muted)]">{lead.quadrant}</span>}
        {lead.budgetEur != null && (
          <span className="ml-auto tabular-nums text-[var(--color-ink)]">
            {new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(lead.budgetEur)}
          </span>
        )}
      </div>
    </Link>
  );
}

const eur0 = (n: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

/**
 * A client relationship, not an engagement. Repeat revenue leads because it is
 * the number a single deal card can never show.
 */
function CompanyCard({ company }: { company: Extract<Block, { type: "companyCard" }> }) {
  const stat = (label: string, value: string) => (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">{label}</div>
      <div className="mt-0.5 tabular-nums text-[var(--color-ink)]">{value}</div>
    </div>
  );
  return (
    <Link
      href={`/dashboard/companies/${company.id}`}
      className="block rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-colors hover:border-[var(--color-brand)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{company.name}</div>
          <div className="mt-0.5 truncate text-xs text-[var(--color-ink-muted)]">
            {[company.industry, company.owner].filter(Boolean).join(" - ") || "-"}
          </div>
        </div>
        {company.repeatValueEur != null && company.repeatValueEur > 0 && (
          <span className="shrink-0 rounded-full border border-[var(--color-mint)] px-2 py-0.5 text-[10px] text-[var(--color-mint)]">
            repeat client
          </span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {stat("Open deals", String(company.openDealCount ?? 0))}
        {stat("Won", String(company.wonDealCount ?? 0))}
        {stat("Lifetime", company.lifetimeValueEur != null ? eur0(company.lifetimeValueEur) : "-")}
        {stat("Repeat", company.repeatValueEur != null ? eur0(company.repeatValueEur) : "-")}
      </div>
    </Link>
  );
}

/**
 * How a priority was arrived at. The two axes are shown side by side with the
 * ease index visibly outside the calculation, because "easy" inflating the
 * ranking is the exact flaw this model replaced.
 */
function ScoreBreakdown({ block }: { block: Extract<Block, { type: "scoreBreakdown" }> }) {
  const axis = (label: string, value: number, tone: string) => (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">{label}</span>
        <span className="tabular-nums text-sm" style={{ color: tone }}>{Math.round(value)}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--color-border)]">
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: tone }} />
      </div>
    </div>
  );

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">{block.name}</div>
          <div className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
            {[block.grade ? `grade ${block.grade}` : null, block.quadrant].filter(Boolean).join(" - ")}
          </div>
        </div>
        <div className="text-right">
          <div className="font-display text-2xl font-semibold tabular-nums text-[var(--color-brand-bright)]">
            {block.priority}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">priority</div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {axis("Opportunity", block.opportunity, "var(--color-amber)")}
        {axis("Winnability", block.winnability, "var(--color-cyan)")}
      </div>
      <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
        √({Math.round(block.opportunity)} × {Math.round(block.winnability)}) = {block.priority}
      </p>

      {(block.ease != null || block.expectedValueEur != null) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-ink-muted)]">
          {block.ease != null && <span>Ease {Math.round(block.ease)} - reported, never blended in</span>}
          {block.expectedValueEur != null && <span className="tabular-nums">Expected value {eur0(block.expectedValueEur)}</span>}
        </div>
      )}

      {block.drivers && block.drivers.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-[var(--color-ink-muted)]">
          {block.drivers.map((d, i) => (
            <li key={i}>
              <span className="text-[var(--color-ink)]">{d.label}</span> - {d.detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Comparison({ items }: { items: Extract<Block, { type: "comparison" }>["items"] }) {  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((it, i) => (
        <div key={i} className="glass p-4">
          <div className="font-display font-semibold text-[var(--color-ink)]">{it.title}</div>
          {it.subtitle && <div className="mt-0.5 text-xs text-[var(--color-ink-faint)]">{it.subtitle}</div>}
          <dl className="mt-3 space-y-2">
            {it.metrics.map((m, j) => (
              <div key={j} className="flex justify-between border-b border-[var(--color-border)] pb-1.5 text-sm">
                <dt className="text-[var(--color-ink-faint)]">{m.label}</dt>
                <dd className="tabular-nums" style={{ color: toneVar(it.tone) }}>{String(m.value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

function Recommendation({ title, rationale, confidence }: { title: string; rationale: string; confidence?: number | null }) {
  return (
    <div className="glass overflow-hidden p-4">
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-full text-xs" style={{ background: "color-mix(in srgb, var(--color-brand) 20%, transparent)", color: "var(--color-brand)" }}>★</span>
        <div className="font-display font-semibold text-[var(--color-ink)]">{title}</div>
        {confidence != null && (
          <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
            {Math.round(confidence * 100)}% confidence
          </span>
        )}
      </div>
      <div className="mt-2 pl-8"><RichText text={rationale} /></div>
    </div>
  );
}

function Timeline({ events }: { events: Extract<Block, { type: "timeline" }>["events"] }) {
  return (
    <ol className="relative space-y-3 pl-5 before:absolute before:left-[3px] before:top-1.5 before:h-[calc(100%-0.75rem)] before:w-px before:bg-[var(--color-border)]">
      {events.map((e, i) => (
        <li key={i} className="relative">
          <span className="absolute -left-5 top-1.5 h-2 w-2 rounded-full ring-2 ring-[var(--color-absolute-zero)]" style={{ background: e.done ? "var(--color-mint)" : "var(--color-border-strong)" }} />
          <div className="flex items-baseline gap-2 text-sm">
            <span className="text-[var(--color-ink)]">{e.label}</span>
            {e.date && <span className="tabular-nums text-xs text-[var(--color-ink-faint)]">{e.date}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function ActionsBar({
  actions,
  onAction,
  pendingAction,
}: {
  actions: ActionSpec[];
  onAction?: (a: ActionSpec) => void;
  pendingAction?: string | null;
}) {
  return (
    <div className="flex flex-wrap gap-2 pt-0.5">
      {actions.map((a, i) => {
        const key = `${a.tool}:${JSON.stringify(a.args ?? {})}`;
        const busy = pendingAction === key;
        const primary = a.style !== "ghost";
        return (
          <button
            key={i}
            disabled={!onAction || busy || !!pendingAction}
            onClick={() => onAction?.(a)}
            className={
              primary
                ? "rounded-full bg-[var(--color-brand)] px-4 py-1.5 text-sm font-medium text-white transition-transform hover:scale-[1.03] disabled:opacity-50"
                : "rounded-full border border-[var(--color-border-strong)] px-4 py-1.5 text-sm text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-frosted-canvas)] hover:text-[var(--color-ink)] disabled:opacity-50"
            }
          >
            {busy ? "Working…" : a.label}
          </button>
        );
      })}
    </div>
  );
}
