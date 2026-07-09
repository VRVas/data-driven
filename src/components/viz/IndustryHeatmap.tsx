"use client";

import { useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import type { IndustryStat } from "@/lib/types";
import { valuationToken } from "@/lib/scoring";

if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger, useGSAP);

/** Map a 0–5 score to a heat colour (rose → amber → mint). */
function heat(v: number | null): string {
  if (v == null) return "var(--color-surface)";
  const t = Math.max(0, Math.min(1, v / 5));
  const hue = 350 + t * 160; // 350 (rose) -> 150 (mint), wrapping through amber
  const h = hue % 360;
  return `hsl(${h} 70% ${28 + t * 14}%)`;
}

const COLS: { key: keyof IndustryStat; label: string; kind: "score" | "pct" | "num" | "val" }[] = [
  { key: "economicalEfficiency", label: "Econ. Efficiency", kind: "score" },
  { key: "easeOfAccess", label: "Ease of Access", kind: "score" },
  { key: "musicVideoFit", label: "Music+Video Fit", kind: "score" },
  { key: "approachedMarket", label: "Approached", kind: "pct" },
  { key: "opened", label: "Opened", kind: "num" },
  { key: "valuation", label: "Valuation", kind: "val" },
];

export function IndustryHeatmap({ industries }: { industries: IndustryStat[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const cells = ref.current?.querySelectorAll<HTMLElement>("[data-cell]");
      if (!cells) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.from(cells, {
        opacity: 0,
        scale: 0.9,
        duration: 0.5,
        ease: "power2.out",
        stagger: { each: 0.015, from: "start", grid: "auto" },
        scrollTrigger: { trigger: ref.current, start: "top 85%", once: true },
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
              Industry
            </th>
            {COLS.map((c) => (
              <th
                key={c.label}
                className="px-2 py-1 text-center text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {industries.map((ind) => (
            <tr key={ind.name}>
              <td className="whitespace-nowrap px-2 py-1 font-medium">{ind.name}</td>
              {COLS.map((c) => {
                const raw = ind[c.key] as number | string | null;
                let bg = "var(--color-surface)";
                let text = "";
                if (c.kind === "score" && typeof raw === "number") {
                  bg = heat(raw);
                  text = raw.toFixed(2);
                } else if (c.kind === "pct" && typeof raw === "number") {
                  bg = heat(raw * 25); // 0–0.2 -> spread across scale
                  text = `${(raw * 100).toFixed(1)}%`;
                } else if (c.kind === "num" && typeof raw === "number") {
                  text = String(raw);
                } else if (c.kind === "val") {
                  bg = valuationToken(raw as "High" | "Medium" | "Low" | null);
                  text = (raw as string) ?? "—";
                }
                const dark = c.kind === "val";
                return (
                  <td key={c.label} className="px-1 py-1 text-center">
                    <span
                      data-cell
                      className="inline-flex h-9 w-full min-w-20 items-center justify-center rounded-md text-xs font-semibold"
                      style={{
                        background: dark ? `color-mix(in srgb, ${bg} 20%, transparent)` : bg,
                        color: dark ? bg : "rgba(255,255,255,0.92)",
                        border: dark ? `1px solid color-mix(in srgb, ${bg} 40%, transparent)` : "none",
                      }}
                    >
                      {text || "—"}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
