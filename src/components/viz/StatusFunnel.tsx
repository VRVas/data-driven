"use client";

import { useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger, useGSAP);

export interface FunnelRow {
  label: string;
  value: number;
  color: string;
}

export function StatusFunnel({ rows }: { rows: FunnelRow[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const max = Math.max(...rows.map((r) => r.value), 1);

  useGSAP(
    () => {
      const bars = ref.current?.querySelectorAll<HTMLElement>("[data-bar]");
      if (!bars) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) return;
      gsap.from(bars, {
        scaleX: 0,
        transformOrigin: "left center",
        duration: 1,
        ease: "power3.out",
        stagger: 0.07,
        scrollTrigger: { trigger: ref.current, start: "top 85%", once: true },
      });
    },
    { scope: ref },
  );

  return (
    // Spreads to fill the card so the funnel carries the same visual weight as
    // whatever it is paired with, rather than floating in the middle of it.
    <div ref={ref} className="flex flex-1 flex-col justify-between gap-2.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3">
          <div className="w-32 shrink-0 text-right text-sm text-[var(--color-ink-muted)]">
            {r.label}
          </div>
          <div className="relative h-8 flex-1 overflow-hidden rounded-md bg-[var(--color-surface)]">
            <div
              data-bar
              className="flex h-full items-center rounded-md px-2.5 text-xs font-semibold text-black/80"
              style={{
                width: `${(r.value / max) * 100}%`,
                background: `linear-gradient(90deg, ${r.color}, color-mix(in srgb, ${r.color} 70%, black))`,
                minWidth: "1.75rem",
              }}
            >
              {r.value}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
