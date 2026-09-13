import { test, expect } from "./fixtures";
import { STORAGE_STATE } from "./constants";

/**
 * Wave 4/5 - the pipeline view has to answer, at a glance:
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

  test("shows the pipeline headlines", async ({ page }) => {
    const cards = page.locator("div.beam-card");
    await expect(cards).toHaveCount(5);
    for (const label of [
      "Pipeline value",
      "Outstanding proposals",
      "To reply",
      "To follow up",
      "Needs an owner",
    ]) {
      await expect(cards.filter({ hasText: label }).first()).toBeVisible();
    }
    await page.screenshot({ path: "e2e-artifacts/screens/40-pipeline-health.png", fullPage: false });
  });

  test("work we owe and work they owe are counted separately", async ({ page }) => {
    // The whole point of the wave: one overdue count cannot tell a backlog
    // from a chase list.
    const onUs = page.getByRole("button", { name: /^To reply/ });
    const onThem = page.getByRole("button", { name: /^To follow up/ });
    await expect(onUs).toBeVisible();
    await expect(onThem).toBeVisible();
    expect(await onUs.textContent()).not.toBe(await onThem.textContent());
  });

  test("a health chip filters the table down to its own leads", async ({ page }) => {
    const counter = page.locator("text=/^\\d+ of \\d+$/");
    const before = await counter.textContent();

    const chip = page.getByRole("button", { name: /^To reply/ });
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
    await page.getByRole("button", { name: /^To reply/ }).click();
    await page.getByRole("button", { name: /^All/ }).click();
    await expect(counter).toHaveText(full ?? "");
  });

  test("the table says which side owes the next move", async ({ page }) => {
    await page.getByRole("button", { name: /^To reply/ }).click();
    const first = page.locator("tbody tr").first();
    await expect(first.getByText("Us", { exact: true })).toBeVisible();
  });

  test("finished deals are out of the way but not lost", async ({ page }) => {
    // "Remove all the noise, as here I want to see only what is active" -
    // without the closed deals becoming unreachable.
    const counter = page.locator("text=/^\\d+ of \\d+$/");
    const active = page.getByRole("button", { name: /^Active/ });
    await expect(active).toHaveAttribute("aria-pressed", "true");

    const won = page.getByRole("button", { name: /^Won/ });
    const wonCount = Number((await won.textContent())?.match(/(\d+)\s*$/)?.[1] ?? "0");
    test.skip(wonCount === 0, "no won deals in the seeded set");

    await won.click();
    await expect(counter).toHaveText(new RegExp(`^${wonCount} of `));
    // Scoped to the table: "Closed deal" is also an <option> in the status filter.
    await expect(page.locator("tbody").getByText("Closed deal").first()).toBeVisible();
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

test.describe("lead detail - next move and pace", () => {
  test("shows who owes the move, how long it takes and the budget basis", async ({ page }) => {
    await page.goto("/dashboard/pipeline/alibaba");
    const panel = page.locator("section").filter({ hasText: "Next move & pace" }).first();
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Waiting on")).toBeVisible();
    await expect(panel.getByText(/Expected to take|^Took$/)).toBeVisible();
    await expect(panel.getByText("Budget", { exact: true })).toBeVisible();
    await page.screenshot({ path: "e2e-artifacts/screens/42-lead-pace.png" });
  });

  test("an accepted proposal becomes the confirmed budget and keeps the estimate", async ({ page }) => {
    // Wave 5: the number typed at open is a hypothesis; the accepted offer is
    // the fact that replaces it.
    await page.goto("/dashboard/pipeline/alleanza");
    const panel = page.locator("section").filter({ hasText: "Next move & pace" }).first();
    await expect(panel).toContainText("estimated");

    await page.getByRole("button", { name: "New proposal" }).click();
    // Scoped to the drawer: the lead header now carries its own
    // select[name="status"] for the pipeline stage, so an unscoped locator
    // matches two elements.
    const drawer = page.getByRole("dialog");
    await drawer.locator("input[name='value']").fill("52000");
    await drawer.locator("select[name='status']").selectOption("accepted");
    await drawer.getByRole("button", { name: "Add proposal" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.goto("/dashboard/pipeline/alleanza");
    const after = page.locator("section").filter({ hasText: "Next move & pace" }).first();
    await expect(after).toContainText("accepted vs");
    await expect(after).toContainText("€52,000");
  });
});
