import { test, expect } from "@playwright/test";
import { STORAGE_STATE } from "./constants";

/**
 * Smooth-scroll verification: ScrollSmoother must take over on desktop with
 * motion enabled, and must stay OUT of the way for touch / reduced-motion.
 */

test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" });

test("landing: ScrollSmoother wraps and drives the page", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(1200);

  // Scaffolding is present.
  await expect(page.locator("#smooth-wrapper")).toHaveCount(1);
  await expect(page.locator("#smooth-content")).toHaveCount(1);

  // ScrollSmoother applies a transform to the content and pins the wrapper.
  const state = await page.evaluate(() => {
    const wrapper = document.querySelector("#smooth-wrapper") as HTMLElement;
    const content = document.querySelector("#smooth-content") as HTMLElement;
    return {
      wrapperPosition: getComputedStyle(wrapper).position,
      contentTransform: getComputedStyle(content).transform,
      bodyHeight: document.body.scrollHeight,
      viewport: window.innerHeight,
    };
  });
  expect(state.wrapperPosition).toBe("fixed");
  expect(state.bodyHeight).toBeGreaterThan(state.viewport);

  // Scrolling moves the content transform (the smoothing effect).
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => ({
    y: window.scrollY,
    transform: getComputedStyle(document.querySelector("#smooth-content") as HTMLElement).transform,
  }));
  expect(after.y).toBeGreaterThan(100);
  expect(after.transform).not.toBe("none");

  // The fixed header must stay glued to the top while scrolled.
  const headerTop = await page.evaluate(
    () => document.querySelector("header")!.getBoundingClientRect().top,
  );
  expect(Math.abs(headerTop)).toBeLessThan(2);
});

test("landing: no horizontal overflow at any width", async ({ page }) => {
  for (const w of [360, 768, 1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto("/");
    await page.waitForTimeout(600);
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
    }));
    expect(overflow.doc, `horizontal overflow at ${w}px`).toBeLessThanOrEqual(overflow.win + 1);
  }
});

test.describe("dashboard smooth scroll", () => {
  test.use({ storageState: STORAGE_STATE });

  test("pipeline scrolls smoothly under a pinned header", async ({ page }) => {
    await page.goto("/dashboard/pipeline");
    await page.waitForTimeout(1200);

    const wrapperPosition = await page.evaluate(
      () => getComputedStyle(document.querySelector("#smooth-wrapper") as HTMLElement).position,
    );
    expect(wrapperPosition).toBe("fixed");

    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(900);

    const headerTop = await page.evaluate(
      () => document.querySelector("header")!.getBoundingClientRect().top,
    );
    expect(Math.abs(headerTop)).toBeLessThan(2);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  });

  test("command palette is portaled to body and centred in the viewport", async ({ page }) => {
    await page.goto("/dashboard/pipeline");
    await page.waitForTimeout(900);
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(900);

    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await expect(dialog).toBeVisible();

    // Portaled straight into <body>, so the smoother's transform can't drag it.
    expect(
      await dialog.evaluate((el) => el.parentElement === document.body),
    ).toBe(true);
    const box = (await dialog.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.y).toBeLessThan(200);
    await page.keyboard.press("Escape");
  });

  test("lead drawer overlays the viewport, not the page", async ({ page }) => {
    await page.goto("/dashboard/pipeline");
    await page.waitForTimeout(900);

    await page.getByRole("button", { name: "+ New lead" }).click();
    const drawer = page.locator("div.fixed.inset-0.z-\\[100\\]");
    await expect(drawer).toBeVisible();

    // Portaled into <body>, so the smoother's transform isn't its containing block.
    expect(await drawer.evaluate((el) => el.parentElement === document.body)).toBe(true);

    const box = (await drawer.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(Math.abs(box.y)).toBeLessThan(2);
    expect(box.height).toBeLessThanOrEqual(vp.height + 2);
    await expect(page.getByRole("heading", { name: "New lead" })).toBeVisible();
  });
});
