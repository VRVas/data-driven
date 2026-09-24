/**
 * ParticleField - a scatter of tiny glowing motes that drift upward, sway and
 * fade on deterministic CSS loops, without per-frame JavaScript style writes.
 * Disabled for reduced-motion users.
 */
import type { CSSProperties } from "react";

const GLOW = ["#9d95ff", "#00bae2", "#abff84", "#fffce1"] as const;

export function ParticleField({ count = 14 }: { count?: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: count }).map((_, index) => {
        const color = GLOW[index % GLOW.length];
        const size = 2 + (index % 3);
        return (
          <span
            key={index}
            className="particle absolute rounded-full"
            style={{
              left: `${(index * 100) / count + 3}%`,
              bottom: "-4%",
              width: size,
              height: size,
              background: color,
              boxShadow: `0 0 ${size * 4}px ${size}px ${color}`,
              "--particle-x": `${(index * 17) % 81 - 40}px`,
              "--particle-y": `${-(120 + (index * 31) % 121)}%`,
              "--particle-opacity": 0.4 + (index % 6) / 10,
              animationDuration: `${9 + (index * 5) % 8}s`,
              animationDelay: `${-(index * 1.7)}s`,
            } as CSSProperties}
          />
        );
      })}
    </div>
  );
}
