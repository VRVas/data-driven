"use client";

import type { Block } from "@/lib/copilot/blocks";
import { toneVar } from "@/lib/copilot/blocks";

type ChartBlock = Extract<Block, { type: "chart" }>;

/** Bespoke, themed SVG charts - bar, donut, scatter, line, progress. */
export function CopilotChart({ block }: { block: ChartBlock }) {
  return (
    <figure className="my-1">
      {block.title && (
        <figcaption className="eyebrow mb-3">{block.title}</figcaption>
      )}
      {block.variant === "bar" && <BarChart series={block.series ?? []} max={block.max} />}
      {block.variant === "progress" && <ProgressChart series={block.series ?? []} max={block.max ?? 5} />}
      {block.variant === "donut" && <DonutChart series={block.series ?? []} />}
      {block.variant === "line" && <LineChart series={block.series ?? []} max={block.max} />}
      {block.variant === "scatter" && (
        <ScatterChart points={block.points ?? []} xLabel={block.xLabel} yLabel={block.yLabel} max={block.max ?? 5} />
      )}
    </figure>
  );
}

type Series = NonNullable<ChartBlock["series"]>;
type Points = NonNullable<ChartBlock["points"]>;

function BarChart({ series, max }: { series: Series; max?: number | null }) {
  const top = max ?? Math.max(1, ...series.map((s) => s.value));
  return (
    <div className="space-y-2">
      {series.map((s, i) => (
        <div key={i} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate text-[var(--color-ink-muted)]" title={s.label}>{s.label}</span>
          <div className="h-2.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-frosted-canvas)_8%,transparent)]">
            <div
              className="h-full rounded-full transition-[width] duration-700 ease-out"
              style={{ width: `${Math.max(2, (s.value / top) * 100)}%`, background: toneVar(s.tone) }}
            />
          </div>
          <span className="tabular-nums text-[var(--color-ink)]">{fmt(s.value)}</span>
        </div>
      ))}
    </div>
  );
}

function ProgressChart({ series, max }: { series: Series; max: number }) {
  return (
    <div className="space-y-3">
      {series.map((s, i) => (
        <div key={i}>
          <div className="mb-1 flex justify-between text-sm">
            <span className="text-[var(--color-ink-muted)]">{s.label}</span>
            <span className="tabular-nums">{fmt(s.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-frosted-canvas)_8%,transparent)]">
            <div
              className="h-full rounded-full transition-[width] duration-700 ease-out"
              style={{ width: `${Math.min(100, (s.value / max) * 100)}%`, background: toneVar(s.tone ?? "brand") }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function DonutChart({ series }: { series: Series }) {
  const total = series.reduce((sum, s) => sum + s.value, 0) || 1;
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const palette = ["brand", "cyan", "mint", "amber", "rose", "violet"];
  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 140 140" className="h-36 w-36 -rotate-90">
        {series.map((s, i) => {
          const frac = s.value / total;
          const dash = frac * c;
          const seg = (
            <circle
              key={i}
              cx="70"
              cy="70"
              r={r}
              fill="none"
              strokeWidth="16"
              stroke={toneVar(s.tone ?? palette[i % palette.length])}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
              style={{ transition: "stroke-dasharray 0.7s ease-out" }}
            />
          );
          offset += dash;
          return seg;
        })}
      </svg>
      <ul className="space-y-1.5 text-sm">
        {series.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: toneVar(s.tone ?? palette[i % palette.length]) }} />
            <span className="text-[var(--color-ink-muted)]">{s.label}</span>
            <span className="tabular-nums text-[var(--color-ink)]">{fmt(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LineChart({ series, max }: { series: Series; max?: number | null }) {
  if (series.length < 2) return <BarChart series={series} max={max} />;
  const w = 320;
  const h = 120;
  const top = max ?? Math.max(1, ...series.map((s) => s.value));
  const step = w / (series.length - 1);
  const pts = series.map((s, i) => [i * step, h - (s.value / top) * (h - 12) - 6] as const);
  const line = pts.map((p) => `${p[0]},${p[1]}`).join(" ");
  const area = `0,${h} ${line} ${w},${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      <polygon points={area} fill="color-mix(in srgb, var(--color-brand) 12%, transparent)" />
      <polyline points={line} fill="none" stroke="var(--color-brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="3" fill="var(--color-brand)" />
      ))}
    </svg>
  );
}

function ScatterChart({ points, xLabel, yLabel, max }: { points: Points; xLabel?: string | null; yLabel?: string | null; max: number }) {
  const w = 300;
  const h = 240;
  const pad = 28;
  const sx = (x: number) => pad + (x / max) * (w - pad * 2);
  const sy = (y: number) => h - pad - (y / max) * (h - pad * 2);
  const mid = max / 2;
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-md">
        {/* quadrant guides */}
        <line x1={sx(mid)} y1={pad} x2={sx(mid)} y2={h - pad} stroke="var(--color-border)" strokeDasharray="3 3" />
        <line x1={pad} y1={sy(mid)} x2={w - pad} y2={sy(mid)} stroke="var(--color-border)" strokeDasharray="3 3" />
        {/* axes */}
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="var(--color-border-strong)" />
        <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="var(--color-border-strong)" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={sx(p.x)} cy={sy(p.y)} r={Math.max(4, Math.min(12, p.size ?? 6))} fill={toneVar(p.tone ?? "brand")} fillOpacity="0.75" />
          </g>
        ))}
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
        <span>{xLabel ?? "x"}</span>
        <span>{yLabel ?? "y"}</span>
      </div>
    </div>
  );
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1000) return new Intl.NumberFormat("en-IE", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  return String(n);
}
