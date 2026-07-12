import { test, expect } from "./fixtures";
import { STORAGE_STATE } from "./constants";
import { shot } from "./helpers";

// Runs with the persisted authenticated session.
test.use({ storageState: STORAGE_STATE });

/**
 * The guided product tour: launch it, step through every stop, and confirm it
 * walks across the whole app (Overview → Pipeline → … → Copilot → finish).
 */
test.describe("product tour", () => {
  test("guided walkthrough covers every surface end-to-end", async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto("/dashboard");
    // Allow the tour to be (re)started deterministically via the launcher.
    await page.evaluate(() => localStorage.removeItem("oovie.tour.v1.done"));

    await page.locator('[data-tour="launcher"]').click();

    const dialog = page.getByRole("dialog", { name: "Product tour" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("h3")).toHaveText("Welcome to BD Intelligence");
    await shot(page, "tour-01-welcome");

    const seen: string[] = [];
    let last = "";
    for (let i = 0; i < 40; i++) {
      const title = (await dialog.locator("h3").textContent().catch(() => ""))?.trim() ?? "";
      if (title && title !== last) {
        seen.push(title);
        last = title;
      }
      if (/^Pipeline/.test(title)) await shot(page, "tour-02-pipeline");
      if (/^Meet the Copilot/.test(title)) await shot(page, "tour-03-copilot");
      if (/all set/i.test(title)) break; // reached the final stop

      await dialog.getByRole("button", { name: "Next" }).click();
      // Advance in lock-step: wait until the step title actually changes.
      await expect(dialog.locator("h3")).not.toHaveText(last, { timeout: 8000 });
    }

    // The final step closes the tour.
    await dialog.getByRole("button", { name: "Finish" }).click();
    await expect(dialog).toBeHidden();

    // It genuinely traversed the core surfaces.
    expect(seen).toContain("Welcome to BD Intelligence");
    expect(seen.some((t) => /^Pipeline/.test(t))).toBeTruthy();
    expect(seen.some((t) => /Copilot/.test(t))).toBeTruthy();
    expect(seen.some((t) => /all set/i.test(t))).toBeTruthy();
    expect(seen.length).toBeGreaterThanOrEqual(12);
  });

  test("relaunches from the top-bar button", async ({ page }) => {
    await page.goto("/dashboard");
    await page.evaluate(() => localStorage.setItem("oovie.tour.v1.done", "1"));
    await page.reload();
    // No auto-start when already completed.
    await expect(page.getByRole("dialog", { name: "Product tour" })).toBeHidden();
    // But the launcher still works.
    await page.locator('[data-tour="launcher"]').click();
    await expect(page.getByRole("dialog", { name: "Product tour" })).toBeVisible();
  });
});
