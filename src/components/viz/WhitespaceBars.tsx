"use client";

import { useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import type { IndustryStat } from "@/lib/types";
import { penetration, whitespace } from "@/lib/tam";
import { valuationToken } from "@/lib/scoring";

if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger, useGSAP);

export function WhitespaceBars({ industries }: { industries: IndustryStat[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const maxTotal = Math.max(...industries.map((i) => i.companiesEU ?? 0), 1);

  useGSAP(
    () => {
      const fills = ref.current?.querySelectorAll<HTMLElement>("[data-fill]");
      if (!fills) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.from(fills, {
        scaleX: 0,
        transformOrigin: "left center",
        duration: 1,
        ease: "power3.out",
        stagger: 0.06,
        scrollTrigger: { trigger: ref.current, start: "top 85%", once: true },
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className="space-y-4">
      {industries.map((ind) => {
        const total = ind.companiesEU ?? 0;
        const pen = penetration(ind.opened, ind.companiesEU) ?? 0;
        const gap = whitespace(ind.opened, ind.companiesEU) ?? 0;
        const color = valuationToken(ind.valuation);
        return (
          <div key={ind.name}>
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
              <span className="font-medium">{ind.name}</span>
              <span className="text-[var(--color-ink-muted)]">
                <span style={{ color }}>{ind.opened}</span> / {total} approached -{" "}
                <span className="text-[var(--color-ink)]">{gap.toLocaleString()}</span> untapped
              </span>
            </div>
            {/* addressable market track, filled by approached share */}
            <div
              className="relative h-6 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]"
              // minWidth keeps the right-aligned percentage from being clipped on short tracks.
              style={{ width: `${Math.max(12, (total / maxTotal) * 100)}%`, minWidth: "5.5rem" }}
            >
              <div
                data-fill
                className="h-full rounded-l-md"
                style={{ width: `${Math.max(2, pen * 100)}%`, background: color }}
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-[var(--color-ink-muted)]">
                {(pen * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
