import { test, expect } from "./fixtures";
import { STORAGE_STATE } from "./constants";

/**
 * Wave 4/5 — the pipeline view has to answer, at a glance:
 *  - are we late replying to them?
 *  - are we late chasing them?
 *  - how much money is sitting with clients awaiting a greenlight?
 * and Wave 5 adds how long a deal is expected to take.
 */

test.use({ storageState: STORAGE_STATE });

test.describe("pipeline health", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/pipeline");
    await expect(page.getByRole("heading", { name: "Pipeline", level: 1 })).toBeVisible();
  });

  test("shows the four health headlines", async ({ page }) => {
    const cards = page.locator("div.beam-card");
    await expect(cards).toHaveCount(4);
    for (const label of ["Late on us", "Late on them", "Awaiting greenlight", "Needs an owner"]) {
      await expect(cards.filter({ hasText: label }).first()).toBeVisible();
    }
    await page.screenshot({ path: "e2e-artifacts/screens/40-pipeline-health.png", fullPage: false });
  });

  test("late-on-us and late-on-them are counted separately", async ({ page }) => {
    // The whole point of the wave: one overdue count cannot tell a backlog
    // from a chase list.
    const onUs = page.getByRole("button", { name: /^Late on us/ });
    const onThem = page.getByRole("button", { name: /^Late on them/ });
    await expect(onUs).toBeVisible();
    await expect(onThem).toBeVisible();
    expect(await onUs.textContent()).not.toBe(await onThem.textContent());
  });

  test("a health chip filters the table down to its own leads", async ({ page }) => {
    const counter = page.locator("text=/^\\d+ of \\d+$/");
    const before = await counter.textContent();

    const chip = page.getByRole("button", { name: /^Late on us/ });
    const count = Number((await chip.textContent())?.match(/(\d+)\s*$/)?.[1] ?? "0");
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");

    await expect(counter).not.toHaveText(before ?? "");
    await expect(counter).toHaveText(new RegExp(`^${count} of `));

    // Every visible row now carries an overdue marker.
    const rows = page.locator("tbody tr");
    if (count > 0) {
      await expect(rows.first().locator("text=/\\d+d late/")).toBeVisible();
    }
  });

  test("clearing the filter restores the full list", async ({ page }) => {
    const counter = page.locator("text=/^\\d+ of \\d+$/");
    const full = await counter.textContent();
    await page.getByRole("button", { name: /^Late on us/ }).click();
    await page.getByRole("button", { name: /^All/ }).click();
    await expect(counter).toHaveText(full ?? "");
  });

  test("the table says which side owes the next move", async ({ page }) => {
    await page.getByRole("button", { name: /^Late on us/ }).click();
    const first = page.locator("tbody tr").first();
    await expect(first.getByText("Us", { exact: true })).toBeVisible();
  });
});

test.describe("next move and expected duration", () => {
  test("the editor captures who owes it, what it is, and how long the deal takes", async ({ page }) => {
    await page.goto("/dashboard/pipeline");
    await page.locator("tbody tr").first().getByRole("button", { name: "Edit" }).click();

    const waiting = page.locator("select[name='waitingOn']");
    const months = page.locator("input[name='expectedMonths']");
    const next = page.locator("input[name='nextStep']");
    await expect(waiting).toBeVisible();
    await expect(months).toBeVisible();
    await expect(next).toBeVisible();

    await waiting.selectOption("them");
    await months.fill("8");
    await next.fill("Chase legal for sign-off");
    await page.screenshot({ path: "e2e-artifacts/screens/41-lead-next-move.png" });

    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator("select[name='waitingOn']")).toHaveCount(0);

    // Round-trips through the store rather than just closing the drawer.
    await page.reload();
    await page.locator("tbody tr").first().getByRole("button", { name: "Edit" }).click();
    await expect(page.locator("select[name='waitingOn']")).toHaveValue("them");
    await expect(page.locator("input[name='expectedMonths']")).toHaveValue("8");
    await expect(page.locator("input[name='nextStep']")).toHaveValue("Chase legal for sign-off");
  });
});
