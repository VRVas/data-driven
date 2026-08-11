"use client";

import { useRef } from "react";
import Link from "next/link";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger, useGSAP);

export interface QuadPoint {
  id: string;
  name: string;
  x: number; // ease of access 0..5
  y: number; // economical efficiency 0..5
  budget: number;
  color: string;
}

const W = 520;
const H = 420;
const PAD = 44;
const MID = 2.75;

export function PriorityQuadrant({ points }: { points: QuadPoint[] }) {
  const ref = useRef<SVGSVGElement>(null);
  const sx = (v: number) => PAD + (v / 5) * (W - PAD * 2);
  const sy = (v: number) => H - PAD - (v / 5) * (H - PAD * 2);
  const r = (b: number) => 5 + Math.sqrt(b / 80000) * 12;

  useGSAP(
    () => {
      const dots = ref.current?.querySelectorAll<SVGCircleElement>("[data-dot]");
      if (!dots) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.from(dots, {
        attr: { r: 0 },
        opacity: 0,
        duration: 0.7,
        ease: "back.out(1.7)",
        stagger: 0.02,
        scrollTrigger: { trigger: ref.current, start: "top 80%", once: true },
      });
    },
    { scope: ref },
  );

  return (
    // Below ~460px the viewBox would scale the labels down to a few pixels, so the
    // chart keeps a legible floor and scrolls sideways instead.
    // w-0 + min-w-full keeps this box's min-content contribution at zero, so an
    // ancestor grid track can't be widened by the chart's minimum width.
    <div className="w-0 min-w-full overflow-x-auto">
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[460px]" role="img" aria-label="Priority quadrant">
      {/* quadrant background tints */}
      <rect x={sx(MID)} y={PAD} width={W - PAD - sx(MID)} height={sy(MID) - PAD}
        fill="color-mix(in srgb, var(--color-mint) 8%, transparent)" />
      <rect x={PAD} y={PAD} width={sx(MID) - PAD} height={sy(MID) - PAD}
        fill="color-mix(in srgb, var(--color-cyan) 6%, transparent)" />

      {/* grid + mid lines */}
      <line x1={sx(MID)} y1={PAD} x2={sx(MID)} y2={H - PAD} stroke="var(--color-border-strong)" strokeDasharray="4 4" />
      <line x1={PAD} y1={sy(MID)} x2={W - PAD} y2={sy(MID)} stroke="var(--color-border-strong)" strokeDasharray="4 4" />

      {/* axes */}
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--color-border)" />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="var(--color-border)" />

      {/* quadrant labels */}
      <text x={W - PAD - 6} y={PAD + 14} textAnchor="end" className="fill-[var(--color-mint)]" fontSize="11" fontWeight="600">Prioritize</text>
      <text x={PAD + 6} y={PAD + 14} className="fill-[var(--color-cyan)]" fontSize="11" fontWeight="600">Quick win</text>
      <text x={W - PAD - 6} y={H - PAD - 8} textAnchor="end" className="fill-[var(--color-ink-faint)]" fontSize="11" fontWeight="600">Strategic</text>
      <text x={PAD + 6} y={H - PAD - 8} className="fill-[var(--color-ink-faint)]" fontSize="11" fontWeight="600">Deprioritize</text>

      {/* axis titles */}
      <text x={W / 2} y={H - 10} textAnchor="middle" className="fill-[var(--color-ink-muted)]" fontSize="11">Ease of access →</text>
      <text x={14} y={H / 2} textAnchor="middle" className="fill-[var(--color-ink-muted)]" fontSize="11" transform={`rotate(-90 14 ${H / 2})`}>Economical efficiency →</text>

      {/* points */}
      {points.map((p) => (
        <Link key={p.id} href={`/dashboard/pipeline#${p.id}`}>
          <circle
            data-dot
            cx={sx(p.x)}
            cy={sy(p.y)}
            r={r(p.budget)}
            fill={`color-mix(in srgb, ${p.color} 22%, transparent)`}
            stroke={p.color}
            strokeWidth={1.5}
            className="cursor-pointer transition-all hover:brightness-125"
          >
            <title>{`${p.name} · ${p.color ? "" : ""}€${p.budget.toLocaleString()} · ease ${p.x.toFixed(1)} / value ${p.y.toFixed(1)}`}</title>
          </circle>
        </Link>
      ))}
    </svg>
    </div>
  );
}
