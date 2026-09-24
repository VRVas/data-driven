import { test, expect } from "./fixtures";
import { STORAGE_STATE } from "./constants";

/**
 * Wave 6 - priority replaces the averaged 0-5 lead score.
 *
 * The complaint was that a €0 project ranked third. The fix is structural:
 * two axes, blended by a geometric mean, with ease reported but never folded
 * in. These check the model actually reaches the screen.
 */

test.use({ storageState: STORAGE_STATE });

test.describe("scoring model", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/scoring");
    await expect(page.getByRole("heading", { name: "Scoring model", level: 1 })).toBeVisible();
  });

  test("documents the two axes and how they combine", async ({ page }) => {
    for (const term of ["Opportunity", "Winnability", "Priority", "Ease", "Strategic value"]) {
      await expect(page.getByText(term, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText(/geometric mean/i).first()).toBeVisible();
    await page.screenshot({ path: "e2e-artifacts/screens/43-scoring-model.png", fullPage: true });
  });

  test("ranks by priority with a grade, not by the old 0-5 average", async ({ page }) => {
    const panel = page.locator('[data-panel="scoring-ranked"]');
    const first = panel.locator("ol > li").first();
    await expect(first).toBeVisible();
    await expect(first).toContainText(/Pursue|Invest|Quick win|Park/);
    // A priority is a 0-100 integer; the old score rendered as "4.02".
    await expect(first).not.toContainText(/\d\.\d{2}/);
  });

  test("the quadrant chart is plotted on the new axes", async ({ page }) => {
    const chart = page.getByRole("group", { name: "Priority quadrant" });
    await expect(chart).toBeVisible();
    await expect(chart.locator("text", { hasText: "Winnability" })).toBeVisible();
    await expect(chart.locator("text", { hasText: "Opportunity" })).toBeVisible();
    for (const label of ["Pursue", "Invest", "Quick win", "Park"]) {
      await expect(chart.locator("text", { hasText: label }).first()).toBeVisible();
    }
  });
});

test.describe("priority on a lead", () => {
  test("headline shows priority, grade and the quadrant", async ({ page }) => {
    await page.goto("/dashboard/pipeline/dell-emea");
    await expect(page.getByText("Priority", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/grade [ABCD]/)).toBeVisible();
    await expect(page.getByText(/opportunity \d+ - winnability \d+/)).toBeVisible();
    await page.screenshot({ path: "e2e-artifacts/screens/44-lead-priority.png" });
  });

  test("strategic value is capturable and moves the priority", async ({ page }) => {
    // A free project should be visible without being able to top the ranking -
    // which only works if someone can actually record why it matters.
    await page.goto("/dashboard/pipeline");
    await page.locator("tbody tr").first().getByRole("button", { name: "Edit" }).click();

    const strategic = page.locator("select[name='strategicValue']");
    const reason = page.locator("select[name='strategicReason']");
    await expect(strategic).toBeVisible();
    await expect(reason).toBeVisible();

    await strategic.selectOption("3");
    await reason.selectOption("Referral source");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator("select[name='strategicValue']")).toHaveCount(0);

    await page.reload();
    await page.locator("tbody tr").first().getByRole("button", { name: "Edit" }).click();
    await expect(page.locator("select[name='strategicValue']")).toHaveValue("3");
    await expect(page.locator("select[name='strategicReason']")).toHaveValue("Referral source");
  });
});
