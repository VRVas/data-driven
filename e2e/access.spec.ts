import { test, expect } from "./fixtures";
import { STORAGE_STATE } from "./constants";
import { shot } from "./helpers";

/**
 * Access management. The seeded E2E account is the founding user, so it holds
 * the administrator profile and can reach every control here.
 */
test.use({ storageState: STORAGE_STATE });

test.describe("access control", () => {
  test("team page lists people and the seeded profiles", async ({ page }) => {
    await page.goto("/dashboard/team");

    await expect(page.getByRole("heading", { level: 1, name: "Team" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Permission profiles" })).toBeVisible();

    // Match the profile cards' headings - the same names also appear as pills in
    // the people table, including a mobile-only copy that is hidden at this width.
    for (const name of ["Administrator", "Sales manager", "Sales rep", "Operations & analysis", "Read only"]) {
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    }

    // The administrator profile is honest about bypassing checks rather than
    // claiming a permission count.
    await expect(page.getByText(/bypasses every permission check/i)).toBeVisible();
    await shot(page, "20-team-access");
  });

  test("built-in profiles cannot be edited, only duplicated", async ({ page }) => {
    await page.goto("/dashboard/team");
    const cards = page.locator("article", { has: page.getByRole("heading", { level: 3 }) });

    // Scoped to the built-in cards. Asserting on EVERY Edit button on the page
    // only held while no custom profile existed, and a custom one being
    // editable is the other half of the same rule.
    const builtIn = cards.filter({ hasText: "Built-in" });
    const builtInCount = await builtIn.count();
    expect(builtInCount).toBeGreaterThan(0);
    for (let i = 0; i < builtInCount; i++) {
      await expect(builtIn.nth(i).getByRole("button", { name: "Edit" })).toBeDisabled();
      await expect(builtIn.nth(i).getByRole("button", { name: "Duplicate" })).toBeEnabled();
    }

    const custom = cards.filter({ hasNotText: "Built-in" });
    for (let i = 0; i < (await custom.count()); i++) {
      await expect(custom.nth(i).getByRole("button", { name: "Edit" })).toBeEnabled();
    }
  });

  test("the profile editor exposes a scoped permission matrix", async ({ page }) => {
    await page.goto("/dashboard/team");
    await page.getByRole("button", { name: "New profile" }).click();

    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    // Portaled out of the page so the scroll smoother's transform can't strand it.
    expect(await drawer.evaluate((el) => el.closest("#smooth-content") === null)).toBe(true);

    // Categories from the catalogue are present, with a scoped control.
    await expect(drawer.getByText("Pipeline", { exact: true }).first()).toBeVisible();
    await expect(drawer.getByText("Team & access", { exact: true }).first()).toBeVisible();
    await expect(drawer.getByText(/High risk/i).first()).toBeVisible();

    await shot(page, "21-profile-editor");
    await page.keyboard.press("Escape");
  });

  test("creating a person requires choosing a profile", async ({ page }) => {
    await page.goto("/dashboard/team");
    await page.getByRole("button", { name: "New person" }).click();

    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByLabel(/name/i).first()).toBeVisible();
    await expect(drawer.getByLabel(/email/i).first()).toBeVisible();
    // Every seeded profile is offered as a choice.
    await expect(drawer.getByText("Sales rep", { exact: true })).toBeVisible();
    await shot(page, "22-create-person");
  });
});
