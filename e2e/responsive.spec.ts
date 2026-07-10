import { test, expect } from "./fixtures";
import { STORAGE_STATE } from "./constants";
import { shot } from "./helpers";

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

test.describe("responsive — public", () => {
  for (const vp of VIEWPORTS) {
    test(`landing holds up at ${vp.name} (${vp.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toContainText("operating system");
      await expect(page.getByRole("heading", { level: 3 })).toHaveCount(6);
      await shot(page, `10-landing-${vp.name}`);
    });
  }
});

test.describe("responsive — dashboard", () => {
  test.use({ storageState: STORAGE_STATE });

  for (const vp of [VIEWPORTS[0], VIEWPORTS[2]]) {
    test(`overview holds up at ${vp.name} (${vp.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/dashboard");
      await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
      await expect(page.getByText("Total pipeline")).toBeVisible();
      await shot(page, `11-dashboard-${vp.name}`);
    });
  }
});
