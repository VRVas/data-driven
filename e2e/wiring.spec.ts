import { test, expect, type Page } from "./fixtures";
import { STORAGE_STATE } from "./constants";
import { setBadge } from "./helpers";

/**
 * The numbers, end to end, through the real app.
 *
 * Every other spec checks a screen. This one follows a single deal's value from
 * the form that captures it to every figure that reports it, because the bugs
 * worth catching here are disagreements between surfaces that are each
 * individually correct.
 *
 * It works on a lead of its own so it never disturbs the seeded book.
 * `teardown-probe.ts` removes it afterwards: the E2E account is a member, and
 * members cannot delete leads, so the spec cannot tidy up through the UI.
 */

test.use({ storageState: STORAGE_STATE });
test.describe.configure({ mode: "serial" });

const NAME = "ZZ Wiring Probe";
const SLUG = "zz-wiring-probe";

/** The euro figure from a KPI card, by its label. */
async function kpi(page: Page, label: string): Promise<number> {
  const card = page.locator("div.beam-card").filter({ hasText: label }).first();
  const text = await card.textContent();
  const match = text?.match(/€([\d,.]+)/);
  return match ? Number(match[1].replace(/[,.]/g, "")) : Number.NaN;
}

/** The lead page uses its own card, keyed on an exact label. */
function metric(page: Page, label: string) {
  return page.locator("div.glass").filter({ has: page.getByText(label, { exact: true }) }).first();
}

/** The panel that shows the budget and says where the figure came from. */
function pace(page: Page) {
  return page.locator("section").filter({ hasText: "Next move & pace" }).first();
}

async function openPipelineValue(page: Page): Promise<number> {
  await page.goto("/dashboard/pipeline");
  return kpi(page, "Pipeline value");
}

/** The client rollup, which now lives on the lead page rather than on its own. */
async function clientRollup(page: Page, label: string): Promise<number> {
  await page.goto(`/dashboard/pipeline/${SLUG}`);
  const dd = page
    .locator("dt", { hasText: new RegExp(`^${label}$`, "i") })
    .first()
    .locator("xpath=following-sibling::dd[1]");
  const text = await dd.textContent();
  const match = text?.match(/\u20ac([\d,.]+)/);
  return match ? Number(match[1].replace(/[,.]/g, "")) : Number.NaN;
}

test.describe("value wiring", () => {
  test("a lead created with a value lands on every surface at once", async ({ page }) => {
    const pipelineBefore = await openPipelineValue(page);

    await page.goto("/dashboard/pipeline");
    await page.getByRole("button", { name: "+ New lead" }).click();
    await page.locator("input[name='name']").fill(NAME);
    await page.locator("select[name='status']").selectOption("Advanced");
    await page.locator("input[name='budget']").fill("45000");
    await page.locator("select[name='industry']").selectOption("Finance");
    await page.getByRole("button", { name: "Create lead" }).click();
    await expect(page.locator("input[name='name']")).toHaveCount(0);

    // The value the form captured is the value the totals moved by.
    expect(await openPipelineValue(page)).toBe(pipelineBefore + 45_000);
    // The same figure reaches the client rollup, which is the surface that used
    // to be a separate page and used to be able to disagree with this one.
    expect(await clientRollup(page, "Open pipeline")).toBe(45_000);

    // And the lead itself is scored, not stranded as "unscored".
    await page.goto(`/dashboard/pipeline/${SLUG}`);
    await expect(page.getByText("unscored")).toHaveCount(0);
    await expect(pace(page)).toContainText("€45,000");
    // A real ranking, which a lead created in the app never used to get.
    expect((await metric(page, "Priority").textContent())!).toMatch(/Priority\d+grade [ABCD]/);
  });

  test("a sent proposal moves the score as well as the money", async ({ page }) => {
    await page.goto(`/dashboard/pipeline/${SLUG}`);
    const before = (await metric(page, "Priority").textContent())!;

    await page.getByRole("button", { name: "New proposal" }).click();
    const draft = page.getByRole("dialog");
    await draft.locator("input[name='value']").fill("80000");
    await draft.locator("select[name='status']").selectOption("sent");
    await draft.getByRole("button", { name: "Add proposal" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.goto(`/dashboard/pipeline/${SLUG}`);
    // The budget follows the proposal, not the opening guess.
    await expect(pace(page)).toContainText("€80,000");
    // And the score moved with it, which is the whole point: the money totals
    // and the ranking used to read two different figures for this deal.
    expect((await metric(page, "Priority").textContent())!).not.toBe(before);

    await page.goto("/dashboard/pipeline");
    await expect(page.locator("div.beam-card").filter({ hasText: "Outstanding proposals" }).first())
      .not.toContainText("€0");
  });

  test("accepting the proposal confirms the budget and keeps the estimate", async ({ page }) => {
    await page.goto(`/dashboard/pipeline/${SLUG}`);
    await page.getByRole("button", { name: "Edit" }).last().click();
    const edit = page.getByRole("dialog");
    await edit.locator("select[name='status']").selectOption("accepted");
    await edit.getByRole("button", { name: /Save|Add proposal/ }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.goto(`/dashboard/pipeline/${SLUG}`);
    // 45,000 was typed at creation; 80,000 was accepted.
    await expect(pace(page)).toContainText("accepted vs");
    await expect(pace(page)).toContainText("€45,000");
  });

  test("closing the deal takes it out of pipeline and into lifetime value", async ({ page }) => {
    const openBefore = await openPipelineValue(page);

    await page.goto(`/dashboard/pipeline/${SLUG}`);
    await setBadge(page, "Pipeline stage", "Deal Closed");
    // The win probability is the observable proof the server re-rendered, not
    // just that the select is showing what was clicked.
    await expect(metric(page, "Expected value")).toContainText("100% win prob.");

    // Out of the live book...
    expect(await openPipelineValue(page)).toBe(openBefore - 80_000);
    // ...and onto the client's record, which is on the lead page now.
    expect(await clientRollup(page, "Lifetime value")).toBe(80_000);
  });
});
