import { test, expect } from "./fixtures";
import { STORAGE_STATE } from "./constants";

test.use({ storageState: STORAGE_STATE });

/** Text of one column, by the header's position. */
async function column(page: import("@playwright/test").Page, header: string) {
  const headers = await page.locator("table thead th").allTextContents();
  const i = headers.findIndex((h) => h.replace(/[↑↓]/g, "").trim() === header);
  expect(i, `column "${header}" exists`).toBeGreaterThanOrEqual(0);
  return page.locator(`table tbody tr td:nth-child(${i + 1})`).allTextContents();
}

test.describe("pipeline sorting", () => {
  test("sort headers work with the keyboard and announce direction", async ({ page }) => {
    await page.goto("/dashboard/pipeline");
    const header = page.getByRole("columnheader", { name: /^Brand/ });
    const button = header.getByRole("button", { name: "Brand" });
    await expect(header).toHaveAttribute("aria-sort", "ascending");
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(header).toHaveAttribute("aria-sort", "descending");
    await page.keyboard.press("Space");
    await expect(header).toHaveAttribute("aria-sort", "ascending");
    await expect(page.getByRole("textbox", { name: "Search pipeline" })).toBeVisible();
  });

  test("waiting on and priority sort like every other column", async ({ page }) => {
    await page.goto("/dashboard/pipeline");

    for (const name of ["Waiting on", "Priority"]) {
      const before = await column(page, name);
      await page.getByRole("columnheader", { name: new RegExp(`^${name}`, "i") }).click();
      const after = await column(page, name);

      expect(after.length).toBe(before.length);
      // Sorting must reorder something, and must not drop or invent rows.
      expect([...after].sort()).toEqual([...before].sort());
      expect(after.join("|")).not.toBe(before.join("|"));
    }
  });

  test("priority orders by rank, not alphabetically", async ({ page }) => {
    await page.goto("/dashboard/pipeline");
    await page.getByRole("columnheader", { name: /^Priority/i }).click();
    const seen = (await column(page, "Priority")).map((s) => s.trim()).filter(Boolean);

    // Alphabetical would put High above Low by luck and Medium in the wrong
    // place; the vocabulary's order is High -> Low.
    const rank = (v: string) => ["High", "Medium", "Low"].findIndex((r) => v.startsWith(r));
    const ranks = seen.map(rank).filter((r) => r >= 0);
    expect(ranks.length).toBeGreaterThan(0);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});
