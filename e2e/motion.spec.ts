import { test, expect } from "@playwright/test";
import { shot, trackConsole } from "./helpers";

/**
 * Full-motion pass - opts back into GSAP animation (the rest of the suite runs
 * reduced-motion for determinism). Proves the animated code path is healthy:
 * the SplitText hero resolves, scroll-triggered reveals fire and nothing throws.
 */
test.use({ reducedMotion: "no-preference" });

test.describe("motion", () => {
  test("animated landing settles without errors", async ({ page }) => {
    const errors = trackConsole(page);
    await page.goto("/");

    // The SplitText headline animates in from a blurred spotlight, then settles.
    await expect(page.getByRole("heading", { level: 1 })).toContainText("operating system", {
      timeout: 15_000,
    });

    // Drive the scroll-triggered reveals + count-ups down the page.
    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" as ScrollBehavior }));
    await expect(page.getByText("Business Development Intelligence")).toBeVisible();

    await shot(page, "06-landing-motion");
    expect(errors, `console errors during animation:\n${errors.join("\n")}`).toEqual([]);
  });
});
