"use client";

/**
 * ParticleField - a scatter of tiny glowing motes that drift upward, sway and
 * fade on independent loops. Deterministic markup (positions from index) keeps
 * SSR + client in sync; all randomness is applied client-side by GSAP after
 * mount, so there is no hydration mismatch. Frozen for reduced-motion users.
 */
import { useRef } from "react";
import { gsap, useGSAP } from "@/lib/gsap/register";

const GLOW = ["#9d95ff", "#00bae2", "#abff84", "#fffce1"] as const;

export function ParticleField({ count = 14 }: { count?: number }) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const dots = gsap.utils.toArray<HTMLElement>(".particle");
      dots.forEach((dot) => {
        const drift = gsap.utils.random(-40, 40);
        gsap.set(dot, { yPercent: gsap.utils.random(0, 100), opacity: 0 });
        gsap
          .timeline({ repeat: -1, delay: gsap.utils.random(0, 6) })
          .to(dot, { opacity: gsap.utils.random(0.4, 0.9), duration: 1.4, ease: "sine.in" })
          .to(
            dot,
            {
              yPercent: `-=${gsap.utils.random(120, 240)}`,
              x: drift,
              duration: gsap.utils.random(9, 16),
              ease: "none",
            },
            0,
          )
          .to(dot, { opacity: 0, duration: 2, ease: "sine.out" }, ">-2.4");
      });
    },
    { scope },
  );

  return (
    <div ref={scope} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: count }).map((_, i) => {
        const color = GLOW[i % GLOW.length];
        const size = 2 + (i % 3);
        return (
          <span
            key={i}
            className="particle absolute rounded-full"
            style={{
              left: `${(i * 100) / count + 3}%`,
              bottom: "-4%",
              width: size,
              height: size,
              background: color,
              boxShadow: `0 0 ${size * 4}px ${size}px ${color}`,
            }}
          />
        );
      })}
    </div>
  );
}
