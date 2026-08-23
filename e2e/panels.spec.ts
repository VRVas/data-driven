import { test, expect } from "./fixtures";
import { STORAGE_STATE } from "./constants";

/**
 * Chart panels: paired cards line up, and any of them can be folded away.
 *
 * The alignment assertion is the one worth having. Every dashboard used to
 * declare its own panel, so two cards side by side were sized by their
 * contents and stopped at different heights - which is visible on any screen
 * and invisible to a test that only asks whether the chart rendered.
 */

test.use({ storageState: STORAGE_STATE, viewport: { width: 1440, height: 900 } });

const PAIRS: { path: string; left: string; right: string }[] = [
  { path: "/dashboard", left: "overview-funnel", right: "overview-quadrant" },
  { path: "/dashboard/scoring", left: "scoring-quadrant", right: "scoring-ranked" },
  { path: "/dashboard/whitespace", left: "ws-map", right: "ws-restricted" },
];

for (const { path, left, right } of PAIRS) {
  test(`${path} pairs its cards at the same height`, async ({ page }) => {
    await page.goto(path);
    const a = page.locator(`[data-panel="${left}"]`);
    const b = page.locator(`[data-panel="${right}"]`);
    await expect(a).toBeVisible();
    await expect(b).toBeVisible();

    const [boxA, boxB] = [await a.boundingBox(), await b.boundingBox()];
    expect(boxA).not.toBeNull();
    expect(boxB).not.toBeNull();
    // Same row, same height. Sub-pixel rounding is allowed; a different size
    // is not.
    expect(Math.abs(boxA!.height - boxB!.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(boxA!.y - boxB!.y)).toBeLessThanOrEqual(1);
  });
}

test("a chart folds away and stays folded", async ({ page }) => {
  await page.goto("/dashboard");
  const panel = page.locator('[data-panel="overview-quadrant"]');
  const fold = panel.getByRole("button", { name: /Collapse Priority quadrant/ });

  await expect(panel.locator("svg[role='img']")).toBeVisible();
  const openHeight = (await panel.boundingBox())!.height;

  await fold.click();
  await expect(panel.locator("svg[role='img']")).toHaveCount(0);
  expect((await panel.boundingBox())!.height).toBeLessThan(openHeight);

  // The preference is the point: re-collapsing it on every visit is worse
  // than not offering the control.
  await page.reload();
  await expect(page.locator('[data-panel="overview-quadrant"] svg[role="img"]')).toHaveCount(0);

  await page.getByRole("button", { name: /Expand Priority quadrant/ }).click();
  await expect(page.locator('[data-panel="overview-quadrant"] svg[role="img"]')).toBeVisible();
});

test("a folded card does not stretch to its open neighbour", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /Collapse Pipeline by stage/ }).click();

  const folded = (await page.locator('[data-panel="overview-funnel"]').boundingBox())!;
  const open = (await page.locator('[data-panel="overview-quadrant"]').boundingBox())!;
  expect(folded.height).toBeLessThan(open.height / 2);
});
