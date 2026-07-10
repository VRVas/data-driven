/**
 * Motion vocabulary — "Midnight kinetic canvas".
 *
 * Pure data (no GSAP import) so it is safe to read from server or client.
 * These are the canonical eases, durations and staggers every animation in
 * the platform speaks in. GSAP registers the named brand eases from `curves`
 * via CustomEase in `register.ts`, so `ease: "brand-snap"` works everywhere.
 */

/** Cubic-bezier control points, keyed by brand name. */
export const curves = {
  /** Assertive entrance — overshoots slightly, then settles. */
  brandSnap: [0.22, 1, 0.36, 1],
  /** Calm, material settle. */
  brandSettle: [0.4, 0, 0.2, 1],
  /** Playful back-out with a little anticipation. */
  brandReverse: [0.68, -0.55, 0.27, 1.55],
  /** Enter fast, ease out. */
  decelerate: [0, 0, 0.2, 1],
  /** Ease in, exit fast. */
  accelerate: [0.4, 0, 1, 1],
  /** Symmetric in/out. */
  smooth: [0.65, 0, 0.35, 1],
} as const;

export type CurveName = keyof typeof curves;

/** Registered GSAP ease id for a given curve (see register.ts). */
export const ease: Record<CurveName, string> = {
  brandSnap: "brand-snap",
  brandSettle: "brand-settle",
  brandReverse: "brand-reverse",
  decelerate: "brand-decelerate",
  accelerate: "brand-accelerate",
  smooth: "brand-smooth",
};

/** Seconds. Mirrors the CSS `--duration-*` tokens. */
export const durations = {
  instant: 0.15,
  fast: 0.3,
  medium: 0.6,
  slow: 1,
  cinematic: 1.6,
} as const;

/** Seconds between staggered children. */
export const staggers = {
  tight: 0.04,
  normal: 0.08,
  relaxed: 0.15,
} as const;

/** `cubic-bezier(...)` string for inline CSS transitions. */
export function cssEase(name: CurveName): string {
  return `cubic-bezier(${curves[name].join(", ")})`;
}
