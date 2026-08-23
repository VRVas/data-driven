"use client";

import { useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import type { MarketSizing } from "@/lib/types";

if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger, useGSAP);

export function MarketSizingBars({ sectors }: { sectors: MarketSizing[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const rows = [...sectors].sort((a, b) => (b.marketSizeUsdBn ?? 0) - (a.marketSizeUsdBn ?? 0));
  const max = Math.max(...rows.map((s) => s.marketSizeUsdBn ?? 0), 1);

  useGSAP(
    () => {
      const bars = ref.current?.querySelectorAll<HTMLElement>("[data-bar]");
      if (!bars) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.from(bars, {
        scaleX: 0,
        transformOrigin: "left center",
        duration: 0.9,
        ease: "power3.out",
        stagger: 0.06,
        scrollTrigger: { trigger: ref.current, start: "top 85%", once: true },
      });
    },
    { scope: ref },
  );

  return (
    // Spreads to fill the card, so a bar list paired with a chart carries the
    // same weight instead of huddling in the middle of it.
    <div ref={ref} className="flex flex-1 flex-col justify-between gap-3">
      {rows.map((s) => (
        <div key={s.sector}>
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
            <span className="min-w-0 truncate font-medium" title={s.sector}>
              {s.sector}
            </span>
            <span className="shrink-0 text-[var(--color-ink-muted)]">
              <span className="font-semibold text-[var(--color-cyan)]">${s.marketSizeUsdBn}B</span>
              <span className="text-[var(--color-ink-faint)]"> - {s.companies}&nbsp;cos.</span>
            </span>
          </div>
          <div className="relative h-3 w-full overflow-hidden rounded-full bg-[var(--color-surface)]">
            <div
              data-bar
              className="h-full rounded-full"
              style={{
                width: `${Math.max(3, ((s.marketSizeUsdBn ?? 0) / max) * 100)}%`,
                background: "linear-gradient(90deg, var(--color-cyan), color-mix(in srgb, var(--color-cyan) 60%, black))",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
