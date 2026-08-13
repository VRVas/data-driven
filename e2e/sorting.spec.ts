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

    // Alphabetical would put Cold first; the vocabulary's order is Hot → Cold.
    const rank = (v: string) => ["Hot", "Warm", "Cold"].findIndex((r) => v.startsWith(r));
    const ranks = seen.map(rank).filter((r) => r >= 0);
    expect(ranks.length).toBeGreaterThan(0);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

test.describe("companies sorting", () => {
  test("every column sorts", async ({ page }) => {
    await page.goto("/dashboard/companies");

    for (const name of ["Company", "Industry", "Deals", "Open pipeline", "Lifetime", "Repeat"]) {
      const before = await column(page, name);
      await page.getByRole("button", { name: new RegExp(`^${name}$`, "i") }).click();
      const after = await column(page, name);

      expect(after.length).toBe(before.length);
      expect([...after].sort()).toEqual([...before].sort());
    }
  });

  test("company sorts A to Z on first click", async ({ page }) => {
    await page.goto("/dashboard/companies");
    await page.getByRole("button", { name: /^Company$/i }).click();
    // The link only — the cell also carries a mobile-only industry line, and
    // textContent concatenates it ("l'oréal" + "fmcg").
    const names = (await page.locator("table tbody tr td:nth-child(1) a").allTextContents()).map((s) =>
      s.trim().toLowerCase(),
    );
    expect(names.length).toBeGreaterThan(1);
    expect(names).toEqual([...names].sort());
  });
});
