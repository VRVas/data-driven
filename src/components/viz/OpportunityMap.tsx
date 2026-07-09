"use client";

import { useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import type { IndustryStat } from "@/lib/types";
import { penetration } from "@/lib/tam";
import { valuationToken } from "@/lib/scoring";

if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger, useGSAP);

const W = 520;
const H = 420;
const PAD = 46;

export function OpportunityMap({ industries }: { industries: IndustryStat[] }) {
  const ref = useRef<SVGSVGElement>(null);
  const pens = industries.map((i) => penetration(i.opened, i.companiesEU) ?? 0);
  const maxPen = Math.max(...pens, 0.07);
  const maxCo = Math.max(...industries.map((i) => i.companiesEU ?? 0), 1);

  const sx = (pen: number) => PAD + (pen / maxPen) * (W - PAD * 2);
  const sy = (eff: number) => H - PAD - (eff / 5) * (H - PAD * 2);
  const r = (co: number) => 6 + Math.sqrt(co / maxCo) * 22;

  useGSAP(
    () => {
      const dots = ref.current?.querySelectorAll<SVGCircleElement>("[data-dot]");
      if (!dots) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.from(dots, {
        attr: { r: 0 },
        opacity: 0,
        duration: 0.8,
        ease: "back.out(1.7)",
        stagger: 0.06,
        scrollTrigger: { trigger: ref.current, start: "top 80%", once: true },
      });
    },
    { scope: ref },
  );

  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Opportunity map">
      {/* prime-whitespace tint: low penetration, high value (top-left) */}
      <rect x={PAD} y={PAD} width={(W - PAD * 2) / 2} height={(H - PAD * 2) / 2}
        fill="color-mix(in srgb, var(--color-mint) 8%, transparent)" />

      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--color-border)" />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="var(--color-border)" />

      <text x={PAD + 8} y={PAD + 14} className="fill-[var(--color-mint)]" fontSize="11" fontWeight="600">
        Prime whitespace
      </text>
      <text x={W / 2} y={H - 12} textAnchor="middle" className="fill-[var(--color-ink-muted)]" fontSize="11">
        Market penetration →
      </text>
      <text x={16} y={H / 2} textAnchor="middle" className="fill-[var(--color-ink-muted)]" fontSize="11" transform={`rotate(-90 16 ${H / 2})`}>
        Economical efficiency →
      </text>

      {industries.map((ind) => {
        const pen = penetration(ind.opened, ind.companiesEU) ?? 0;
        const eff = ind.economicalEfficiency ?? 0;
        const color = valuationToken(ind.valuation);
        return (
          <g key={ind.name}>
            <circle
              data-dot
              cx={sx(pen)}
              cy={sy(eff)}
              r={r(ind.companiesEU ?? 0)}
              fill={`color-mix(in srgb, ${color} 22%, transparent)`}
              stroke={color}
              strokeWidth={1.5}
            >
              <title>{`${ind.name} · ${(pen * 100).toFixed(1)}% approached · ${ind.companiesEU} companies · ${ind.valuation}`}</title>
            </circle>
            <text x={sx(pen)} y={sy(eff) - r(ind.companiesEU ?? 0) - 4} textAnchor="middle" className="fill-[var(--color-ink-muted)]" fontSize="10">
              {ind.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
