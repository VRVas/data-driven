"use client";

import { useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { eur } from "@/lib/scoring";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger, useGSAP);
}

export type NumberFormat = "int" | "eur" | "percent";

function fmt(n: number, f: NumberFormat): string {
  if (f === "eur") return eur(n);
  if (f === "percent") return `${Math.round(n)}%`;
  return Math.round(n).toLocaleString();
}

interface Props {
  value: number;
  format?: NumberFormat;
  className?: string;
  duration?: number;
}

/** Counts up to `value` when scrolled into view. */
export function AnimatedNumber({ value, format = "int", className, duration = 1.6 }: Props) {
  const ref = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) {
        el.textContent = fmt(value, format);
        return;
      }
      const obj = { n: 0 };
      gsap.to(obj, {
        n: value,
        duration,
        ease: "power2.out",
        onUpdate: () => {
          el.textContent = fmt(obj.n, format);
        },
        scrollTrigger: { trigger: el, start: "top 90%", once: true },
      });
    },
    { scope: ref, dependencies: [value] },
  );

  return <span ref={ref} className={className}>{fmt(0, format)}</span>;
}
