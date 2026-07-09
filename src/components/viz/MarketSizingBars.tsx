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
    <div ref={ref} className="space-y-2.5">
      {rows.map((s) => (
        <div key={s.sector} className="flex items-center gap-3">
          <div className="w-44 shrink-0 truncate text-right text-sm text-[var(--color-ink-muted)]" title={s.sector}>
            {s.sector}
          </div>
          <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-[var(--color-surface)]">
            <div
              data-bar
              className="flex h-full items-center rounded-md px-2.5 text-xs font-semibold text-black/80"
              style={{
                width: `${Math.max(6, ((s.marketSizeUsdBn ?? 0) / max) * 100)}%`,
                background: "linear-gradient(90deg, var(--color-cyan), color-mix(in srgb, var(--color-cyan) 60%, black))",
              }}
            >
              ${s.marketSizeUsdBn}B
            </div>
          </div>
          <div className="w-24 shrink-0 text-right text-xs text-[var(--color-ink-faint)]">
            {s.companies}&nbsp;cos.
          </div>
        </div>
      ))}
    </div>
  );
}
