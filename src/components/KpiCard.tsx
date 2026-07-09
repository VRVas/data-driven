import type { ReactNode } from "react";
import { AnimatedNumber, type NumberFormat } from "./AnimatedNumber";

interface Props {
  label: string;
  value: number;
  format?: NumberFormat;
  hint?: ReactNode;
  accent?: string;
}

export function KpiCard({ label, value, format, hint, accent = "var(--color-brand)" }: Props) {
  return (
    <div className="glass relative overflow-hidden p-5">
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
      />
      <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
        {label}
      </div>
      <div className="mt-2 font-display text-3xl font-semibold tracking-tight">
        <AnimatedNumber value={value} format={format} />
      </div>
      {hint && <div className="mt-1.5 text-sm text-[var(--color-ink-muted)]">{hint}</div>}
    </div>
  );
}
