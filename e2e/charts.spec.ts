import { test, expect } from "@playwright/test";
import { STORAGE_STATE } from "./constants";

// Full motion on purpose. The rest of the suite runs reduced-motion, which
// skips these animations entirely - so under the shared fixture these tests
// would pass whether or not the charts are broken.
test.use({ storageState: STORAGE_STATE, reducedMotion: "no-preference" });

/**
 * Charts that animate in are one unfired trigger away from being permanently
 * blank, and a "does it render" assertion passes either way because the
 * elements exist. These check the dots are actually *painted*.
 */
async function paintedDots(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<SVGCircleElement>("[data-dot]")].filter(
      (d) => Number(d.getAttribute("r")) > 0 && Number(getComputedStyle(d).opacity) > 0.05,
    ).length,
  );
}

for (const { path, name } of [
  { path: "/dashboard", name: "overview priority quadrant" },
  { path: "/dashboard/scoring", name: "scoring priority quadrant" },
  { path: "/dashboard/whitespace", name: "whitespace opportunity map" },
]) {
  test(`${name} plots its leads`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("[data-dot]").first()).toBeAttached();
    const total = await page.locator("[data-dot]").count();
    expect(total).toBeGreaterThan(0);

    await expect
      .poll(() => paintedDots(page), { timeout: 15_000 })
      .toBeGreaterThan(total * 0.8);
  });
}

test("the hero headline is not left transparent by its own animation", async ({ page }) => {
  await page.goto("/");
  const gradient = page.locator(".text-gradient").first();
  await expect(gradient).toBeVisible();

  // The split leaves each character in a filtered span, which paints in its own
  // layer and drops the parent's background-clip:text gradient. Reverting the
  // split is what keeps the words readable, so assert the split is gone.
  await expect.poll(() => page.locator(".hero-char").count(), { timeout: 15_000 }).toBe(0);
  await expect(gradient).toHaveText(/operating system/i);
});
