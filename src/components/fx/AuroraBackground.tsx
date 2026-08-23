"use client";

/**
 * AuroraBackground - slow-drifting blurred colour fields behind content.
 *
 * Three brand blobs breathe across the canvas on long sine loops (yoyo), giving
 * the "Midnight kinetic canvas" its living glow. Purely decorative; frozen for
 * reduced-motion users. Absolutely positioned to fill its nearest positioned
 * ancestor - drop it into any `relative` section.
 */
import { useRef } from "react";
import { gsap, useGSAP } from "@/lib/gsap/register";
import { ease } from "@/lib/motion";

const BRAND = ["#00bae2", "#9d95ff", "#abff84"] as const;

export function AuroraBackground({ className = "" }: { className?: string }) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const blobs = gsap.utils.toArray<HTMLElement>(".aurora-blob");
      blobs.forEach((blob, i) => {
        gsap.to(blob, {
          xPercent: gsap.utils.random(-18, 18),
          yPercent: gsap.utils.random(-16, 16),
          scale: gsap.utils.random(1.05, 1.35),
          opacity: gsap.utils.random(0.14, 0.22),
          duration: gsap.utils.random(8, 13),
          ease: ease.smooth,
          repeat: -1,
          yoyo: true,
          delay: i * 0.6,
        });
      });
    },
    { scope },
  );

  return (
    <div
      ref={scope}
      aria-hidden
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      {BRAND.map((color, i) => (
        <div
          key={color}
          className="aurora-blob absolute h-[46vw] w-[46vw] rounded-full opacity-[0.13] mix-blend-screen"
          style={{
            background: `radial-gradient(circle at center, ${color}, transparent 68%)`,
            filter: "blur(90px)",
            left: `${[8, 55, 30][i]}%`,
            top: `${[-8, 12, 48][i]}%`,
          }}
        />
      ))}
    </div>
  );
}
