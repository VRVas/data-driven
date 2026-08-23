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
    test.setTimeout(180_000);

    await page.goto("/dashboard");
    // Allow the tour to be (re)started deterministically via the launcher.
    await page.evaluate(() => localStorage.removeItem("oovie.tour.v1.done"));

    await page.locator('[data-tour="launcher"]').click();

    const dialog = page.getByRole("dialog", { name: "Product tour" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("h3")).toHaveText("Welcome to BD Intelligence");
    await shot(page, "tour-01-welcome");

    const seen: string[] = [];
    let badges = 0;
    let last = "";
    for (let i = 0; i < 50; i++) {
      const title = (await dialog.locator("h3").textContent().catch(() => ""))?.trim() ?? "";
      if (title && title !== last) {
        seen.push(title);
        if (await dialog.getByText("New in v1.1").isVisible().catch(() => false)) badges += 1;
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

    // v1.1 surfaces the tour previously said nothing about.
    expect(seen.some((t) => /owes the next move/i.test(t))).toBeTruthy();
    expect(seen.some((t) => /Companies/i.test(t))).toBeTruthy();
    // The count itself is checked against the real registry in copilot.test.ts;
    // here it only has to be a step that quotes one.
    expect(seen.some((t) => /\d+ tools/i.test(t))).toBeTruthy();
    // The badge has to actually render, not just exist in the data.
    expect(badges).toBeGreaterThanOrEqual(4);
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
