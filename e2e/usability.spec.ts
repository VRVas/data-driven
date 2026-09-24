import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";
import { STORAGE_STATE } from "./constants";

test.use({ storageState: STORAGE_STATE });

for (const width of [390, 1440]) {
  test.describe(`accessible core screens at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    for (const route of ["/dashboard", "/dashboard/pipeline", "/dashboard/agents", "/dashboard/scoring", "/dashboard/industries", "/dashboard/whitespace", "/dashboard/quality", "/dashboard/reminders", "/dashboard/outbox", "/dashboard/copilot", "/dashboard/copilot/integrations"]) {
      test(`${route} has no automated WCAG violations or page overflow`, async ({ page }) => {
        await page.goto(route);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
        expect(result.violations.map(violation => ({ id: violation.id, targets: violation.nodes.map(node => node.target) }))).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      });
    }
  });
}

test("command palette keeps focus, announces selection and restores the opener", async ({ page }) => {
  await page.goto("/dashboard/pipeline");
  const opener = page.getByRole("textbox", { name: "Search pipeline" });
  await opener.focus();
  await page.keyboard.press("Control+k");
  const search = page.getByRole("combobox", { name: "Command palette search" });
  await expect(search).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(search).toHaveAttribute("aria-activedescendant", "command-palette-option-1");
  await page.keyboard.press("Tab");
  await expect(search).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("mobile menu traps keyboard focus and restores its trigger", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  const opener = page.getByRole("button", { name: "Open menu" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Menu", exact: true });
  await expect(dialog.getByRole("button", { name: "Close menu" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Sign out" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});