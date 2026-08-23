import { test as base, expect } from "@playwright/test";

/**
 * Shared test object that forces `prefers-reduced-motion: reduce` before every
 * navigation. The app's hero, `Reveal` and `AnimatedNumber` all honour it, so
 * pages render in their final, settled state - deterministic assertions and
 * clean full-page screenshots (no half-finished GSAP frames). The config-level
 * `use.reducedMotion` proved unreliable here, so we emulate it at runtime.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
    await use(page);
  },
});

export { expect };
