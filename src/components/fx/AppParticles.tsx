"use client";

/**
 * AppParticles - global, fixed particle layer that sits behind all content.
 * Mount once near the root so motes drift across the whole app.
 */
import { ParticleField } from "./ParticleField";

export function AppParticles() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      <ParticleField count={16} />
    </div>
  );
}
