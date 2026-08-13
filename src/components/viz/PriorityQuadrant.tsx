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
  /** Winnability 0–100. */
  x: number;
  /** Opportunity 0–100. */
  y: number;
  budget: number;
  color: string;
}

const W = 520;
const H = 420;
const PAD = 44;
const AXIS_MAX = 100;

interface Props {
  points: QuadPoint[];
  /** Winnability threshold — right of it a deal is judged movable. */
  xMid?: number;
  /** Opportunity threshold — above it a deal is judged worth real effort. */
  yMid?: number;
  xTitle?: string;
  yTitle?: string;
  labels?: { topRight: string; topLeft: string; bottomRight: string; bottomLeft: string };
}

const DEFAULT_LABELS = {
  topRight: "Pursue",
  topLeft: "Invest",
  bottomRight: "Quick win",
  bottomLeft: "Park",
};

export function PriorityQuadrant({
  points,
  xMid = 45,
  yMid = 35,
  xTitle = "Winnability →",
  yTitle = "Opportunity →",
  labels = DEFAULT_LABELS,
}: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const sx = (v: number) => PAD + (v / AXIS_MAX) * (W - PAD * 2);
  const sy = (v: number) => H - PAD - (v / AXIS_MAX) * (H - PAD * 2);
  const r = (b: number) => 5 + Math.sqrt(Math.max(0, b) / 80000) * 12;

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
        // Without this a `from` tween applies its start state the moment it is
        // created, so every dot sat at r=0 until the trigger fired — and if it
        // never fired (the smooth-scroll container measures differently) the
        // chart stayed permanently empty. Now the dots render normally and the
        // animation only takes over once it actually runs.
        immediateRender: false,
        scrollTrigger: { trigger: ref.current, start: "top 95%", once: true },
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
      <rect x={sx(xMid)} y={PAD} width={W - PAD - sx(xMid)} height={sy(yMid) - PAD}
        fill="color-mix(in srgb, var(--color-mint) 8%, transparent)" />
      <rect x={PAD} y={PAD} width={sx(xMid) - PAD} height={sy(yMid) - PAD}
        fill="color-mix(in srgb, var(--color-cyan) 6%, transparent)" />

      {/* grid + mid lines */}
      <line x1={sx(xMid)} y1={PAD} x2={sx(xMid)} y2={H - PAD} stroke="var(--color-border-strong)" strokeDasharray="4 4" />
      <line x1={PAD} y1={sy(yMid)} x2={W - PAD} y2={sy(yMid)} stroke="var(--color-border-strong)" strokeDasharray="4 4" />

      {/* axes */}
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--color-border)" />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="var(--color-border)" />

      {/* quadrant labels */}
      <text x={W - PAD - 6} y={PAD + 14} textAnchor="end" className="fill-[var(--color-mint)]" fontSize="11" fontWeight="600">{labels.topRight}</text>
      <text x={PAD + 6} y={PAD + 14} className="fill-[var(--color-cyan)]" fontSize="11" fontWeight="600">{labels.topLeft}</text>
      <text x={W - PAD - 6} y={H - PAD - 8} textAnchor="end" className="fill-[var(--color-ink-faint)]" fontSize="11" fontWeight="600">{labels.bottomRight}</text>
      <text x={PAD + 6} y={H - PAD - 8} className="fill-[var(--color-ink-faint)]" fontSize="11" fontWeight="600">{labels.bottomLeft}</text>

      {/* axis titles */}
      <text x={W / 2} y={H - 10} textAnchor="middle" className="fill-[var(--color-ink-muted)]" fontSize="11">{xTitle}</text>
      <text x={14} y={H / 2} textAnchor="middle" className="fill-[var(--color-ink-muted)]" fontSize="11" transform={`rotate(-90 14 ${H / 2})`}>{yTitle}</text>

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
            <title>{`${p.name} · €${p.budget.toLocaleString()} · winnability ${p.x.toFixed(0)} / opportunity ${p.y.toFixed(0)}`}</title>
          </circle>
        </Link>
      ))}
    </svg>
    </div>
  );
}
