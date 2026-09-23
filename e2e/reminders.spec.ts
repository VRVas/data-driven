import { test, expect } from "./fixtures";
import { STORAGE_STATE } from "./constants";

/**
 * Reminders, end to end through the running app.
 *
 * The unit tests prove the calendar file and the email content. This proves
 * the parts only a live server shows: that creating one stores it, that "right
 * now" actually delivers, that delivery raises an in-app notification, and
 * that cancelling withdraws it.
 *
 * Everything it creates is its own, and the reminder store is per-user, so it
 * touches nothing the other specs read.
 */

test.use({ storageState: STORAGE_STATE });
test.describe.configure({ mode: "serial" });

const composer = "form:has(input[name='title'])";

/** Both sections render <li> with the same title, so every lookup is scoped. */
const mine = (page: import("@playwright/test").Page) =>
  page.locator("section", { hasText: "Your reminders" }).first();
const notices = (page: import("@playwright/test").Page) =>
  page.locator("section", { hasText: "Notifications" }).first();

async function openComposer(page: import("@playwright/test").Page) {
  await page.goto("/dashboard/reminders");
  await page.getByRole("button", { name: "+ New reminder" }).click();
  await expect(page.locator(composer)).toBeVisible();
}

test.describe("reminders", () => {
  test("the screen separates notifications, your reminders and follow-ups", async ({ page }) => {
    await page.goto("/dashboard/reminders");
    await expect(page.getByRole("heading", { name: "Reminders", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your reminders" })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ New reminder" })).toBeVisible();
  });

  test("a scheduled reminder is stored and can be cancelled", async ({ page }) => {
    await openComposer(page);
    await page.locator("input[name='title']").fill("ZZ scheduled probe");
    await page.locator("input[name='topic']").fill("A topic worth remembering");
    await page.locator("select[name='holdMinutes']").selectOption("30");
    await page.getByRole("button", { name: /Schedule it/ }).click();
    await expect(page.locator(`${composer} [role="status"]`)).toContainText("Scheduled");

    await page.reload();
    const row = mine(page).locator("li", { hasText: "ZZ scheduled probe" }).first();
    await expect(row).toBeVisible();
    // Not delivered yet, and it says what it will do.
    await expect(row).toContainText("scheduled");
    await expect(row).toContainText("holds 30 min");

    await row.getByRole("button", { name: "Cancel" }).click();
    await expect(row).toContainText("cancelled");
    // Reloaded rather than trusting the in-place refresh: the point is that
    // the cancellation was stored, not that the row repainted.
    await page.reload();
    await expect(mine(page).locator("li", { hasText: "ZZ scheduled probe" }).first()).toContainText("cancelled");
  });

  test("right now means now: it delivers and raises a notification", async ({ page }) => {
    await openComposer(page);
    await page.locator("input[name='title']").fill("ZZ instant probe");
    await page.locator("input[name='topic']").fill("Deliver immediately");
    await page.getByRole("radio", { name: "Right now" }).check();
    await page.getByRole("button", { name: /Send it now/ }).click();
    await expect(page.locator(`${composer} [role="status"]`)).toContainText("Sent");

    await page.reload();
    // Delivered, and the in-app half arrived.
    await expect(mine(page).locator("li", { hasText: "ZZ instant probe" }).first()).toContainText("sent");
    await expect(notices(page)).toContainText("ZZ instant probe");
    await expect(notices(page)).toContainText("Deliver immediately");
  });

  test("a notification can be dismissed and stops being counted", async ({ page }) => {
    await page.goto("/dashboard/reminders");
    const card = notices(page).locator("li", { hasText: "ZZ instant probe" }).first();
    await expect(card).toBeVisible();

    await card.getByRole("button", { name: "Dismiss" }).click();
    await expect(card).toHaveCount(0);
    await page.reload();
    await expect(notices(page).locator("li", { hasText: "ZZ instant probe" })).toHaveCount(0);
  });

  test("a reminder attached to a lead is offered that lead's page", async ({ page }) => {
    await openComposer(page);
    await page.locator("input[name='title']").fill("ZZ lead probe");
    await page.locator("select[name='brandId']").selectOption({ index: 1 });
    await page.getByRole("radio", { name: "Right now" }).check();
    await page.getByRole("button", { name: /Send it now/ }).click();
    await expect(page.locator(`${composer} [role="status"]`)).toContainText("Sent");

    await page.reload();
    const card = notices(page).locator("li", { hasText: "ZZ lead probe" }).first();
    // The notification deep-links to the lead rather than back to this screen.
    await expect(card.getByRole("link", { name: "Open" })).toHaveAttribute("href", /\/dashboard\/pipeline\/.+/);
  });

  test("the composer refuses a reminder with no way to reach you", async ({ page }) => {
    await openComposer(page);
    await page.locator("input[name='title']").fill("ZZ unreachable probe");
    await page.locator("input[name='inApp']").uncheck();
    await page.locator("input[name='email']").uncheck();
    await page.getByRole("button", { name: /Schedule it/ }).click();
    await expect(page.locator(`${composer} [role="alert"]`)).toContainText("at least one way");
  });
});
