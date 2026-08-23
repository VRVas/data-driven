import { test, expect, type Locator, type Page } from "@playwright/test";
import { STORAGE_STATE } from "./constants";

/**
 * Slide-over drawers must escape their transformed ancestors.
 *
 * `Reveal` animates with `gsap.from()`, which leaves an inline
 * `transform: matrix(1,0,0,1,0,0)` on its wrapper (ScrollSmoother does the same
 * to `#smooth-content`). A non-`none` transform makes that wrapper the
 * containing block for any `position: fixed` descendant, so a drawer rendered
 * inline gets trapped inside the wrapper's box - on the lead-detail page the
 * `Reveal` only wraps a short header, which squeezed the drawer into a thin
 * band. `OverlayPortal` fixes it by portaling overlays to <body>.
 *
 * WHY MOTION MUST BE ON: under reduced motion `Reveal` skips the tween, no
 * inline transform is ever written, and the bug simply cannot reproduce - so
 * this spec opts back into full GSAP motion and must NOT be switched to
 * `./fixtures`, which forces `prefers-reduced-motion: reduce` on every page.
 */

test.use({
  storageState: STORAGE_STATE,
  viewport: { width: 1440, height: 900 },
  reducedMotion: "no-preference",
});

/** `z-[100]` is an arbitrary-value Tailwind class - the brackets need CSS escaping. */
const DRAWER = "div.fixed.inset-0.z-\\[100\\]";
const TOL = 2;

/** Computed `transform` of every ancestor of `el`, closest first. */
function ancestorTransforms(el: Locator): Promise<string[]> {
  return el.evaluate((node) => {
    const out: string[] = [];
    for (let p = node.parentElement; p; p = p.parentElement) out.push(getComputedStyle(p).transform);
    return out;
  });
}

/**
 * Proves the trap condition still exists: if nothing above the trigger is
 * transformed any more, the drawer assertions below would pass vacuously.
 */
async function expectTransformedAncestor(trigger: Locator) {
  const transforms = await ancestorTransforms(trigger);
  expect(
    transforms.filter((t) => t && t !== "none"),
    `expected a transformed ancestor (Reveal / ScrollSmoother), saw:\n${transforms.join("\n")}`,
  ).not.toHaveLength(0);
}

/** The open drawer must live on <body> and cover the whole viewport. */
async function expectPortaledFullScreenDrawer(page: Page) {
  const drawer = page.locator(DRAWER);
  await expect(drawer).toBeVisible();

  const portaled = await drawer.evaluate((node) => node.parentElement === document.body);
  expect(portaled, "drawer is not portaled to <body>").toBe(true);

  // The overlay locks body scrolling, so the page scrollbar is gone and the
  // layout viewport is the full 1440×900.
  const view = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  }));
  expect(Math.abs(view.width - 1440)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(view.height - 900)).toBeLessThanOrEqual(TOL);

  const box = await drawer.boundingBox();
  expect(box, "drawer has no bounding box").not.toBeNull();
  expect(Math.abs(box!.x)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(box!.y)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(box!.width - view.width)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(box!.height - view.height)).toBeLessThanOrEqual(TOL);
}

test.describe("overlay drawers escape transformed ancestors", () => {
  test("lead detail: the Edit lead drawer covers the viewport", async ({ page }) => {
    await page.goto("/dashboard/pipeline/alibaba");
    await expect(page.getByRole("heading", { level: 1, name: "Alibaba" })).toBeVisible();
    await page.waitForTimeout(1200); // let the reveal finish and settle its inline transform

    const trigger = page.getByRole("button", { name: "Edit lead" });
    await expect(trigger).toBeVisible();
    await expectTransformedAncestor(trigger);

    await trigger.click();
    await expectPortaledFullScreenDrawer(page);
    await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
  });

  test("pipeline list: the New lead drawer covers the viewport", async ({ page }) => {
    await page.goto("/dashboard/pipeline");
    await expect(page.getByRole("heading", { level: 1, name: "Pipeline" })).toBeVisible();
    await page.waitForTimeout(1200);

    const trigger = page.getByRole("button", { name: "+ New lead" });
    await expect(trigger).toBeVisible();
    await expectTransformedAncestor(trigger);

    await trigger.click();
    await expectPortaledFullScreenDrawer(page);
    // Same editor, "new" variant - its submit button reads "Create lead".
    await expect(page.getByRole("button", { name: "Create lead" })).toBeVisible();
  });
});
