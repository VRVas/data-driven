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

  // The full horizontal nav only fits from `xl` (1280px) up; below that it
  // collapses into the hamburger drawer, which must still reach every section.
  for (const vp of [VIEWPORTS[0], VIEWPORTS[1], { name: "small-laptop", width: 1024, height: 768 }]) {
    test(`menu drawer navigates at ${vp.name} (${vp.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/dashboard");

      await expect(page.getByRole("navigation")).toBeHidden();
      await page.getByRole("button", { name: "Open menu" }).click();

      const drawer = page.getByRole("dialog", { name: "Menu" });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
      await shot(page, `12-menu-${vp.name}`);

      await drawer.getByRole("link", { name: "Whitespace", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard\/whitespace$/);
      await expect(drawer).toBeHidden();
    });
  }

  test("no horizontal overflow on dashboard pages", async ({ page }) => {
    const routes = ["/dashboard", "/dashboard/pipeline", "/dashboard/agents", "/dashboard/team"];
    for (const width of [360, 768, 1024, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of routes) {
        await page.goto(route);
        const { doc, win } = await page.evaluate(() => ({
          doc: document.documentElement.scrollWidth,
          win: window.innerWidth,
        }));
        expect(doc, `${route} overflows at ${width}px`).toBeLessThanOrEqual(win + 1);
      }
    }
  });
});
