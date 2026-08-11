import { test, expect } from "./fixtures";
import { STORAGE_STATE } from "./constants";
import { shot, trackConsole } from "./helpers";

/**
 * The Companies area — the Company → Deal → Proposal split.
 *
 * The seeded E2E account is the founding user, so it holds the administrator
 * profile and can reach every company and deal here.
 */
test.use({ storageState: STORAGE_STATE });

/** Money figures on the list page, in render order. */
const KPIS = ["Open pipeline", "Awaiting decision", "Repeat revenue", "Proposal win rate"];

test.describe("companies", () => {
  test("the list renders with its money KPIs", async ({ page }) => {
    test.slow(); // dev compiles /dashboard/companies on the first visit
    const errors = trackConsole(page);
    await page.goto("/dashboard/companies");

    await expect(page.getByRole("heading", { level: 1, name: "Companies" })).toBeVisible();
    await expect(page.getByText("Accounts", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "By open pipeline" })).toBeVisible();

    // "Open pipeline" is also a column header in the table below, so scope the
    // KPI assertions to the cards rather than matching the text page-wide.
    const kpis = page.locator("div.beam-card");
    await expect(kpis).toHaveCount(KPIS.length);
    for (const label of KPIS) {
      const card = kpis.filter({ hasText: label });
      await expect(card, `KPI card "${label}"`).toHaveCount(1);
      await expect(card).toBeVisible();
    }

    // Every row opens the company behind it.
    const rows = page.locator('table a[href^="/dashboard/companies/"]');
    expect(await rows.count(), "the table should link at least one company").toBeGreaterThan(0);
    await expect(rows.first()).toBeVisible();

    await shot(page, "30-companies");
    expect(errors, `console errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("a company detail page shows its deals", async ({ page }) => {
    await page.goto("/dashboard/companies/co-alibaba");

    await expect(page.getByRole("heading", { level: 1, name: "Alibaba" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Deals" })).toBeVisible();

    // A deal id IS the old lead id, so the row links straight back into the
    // pipeline route that has always existed.
    const deal = page.locator('a[href="/dashboard/pipeline/alibaba"]');
    await expect(deal).toHaveCount(1);
    await expect(deal).toBeVisible();
    await expect(deal).toHaveText(/Alibaba/);

    await shot(page, "31-company-detail");
  });

  test("lead URLs still work after the split", async ({ page }) => {
    await page.goto("/dashboard/pipeline/alibaba");

    // `Deal.id === Brand.id` is the invariant that preserved every existing URL.
    await expect(page.getByRole("heading", { level: 1, name: "Alibaba" })).toBeVisible();

    // ...and the lead now carries a Company card pointing the other way. The
    // top-bar link is /dashboard/companies with no trailing slash, so this
    // prefix matches the card alone.
    const company = page.locator('a[href^="/dashboard/companies/"]');
    await expect(company).toHaveCount(1);
    await expect(company).toBeVisible();
    await expect(company).toHaveAttribute("href", "/dashboard/companies/co-alibaba");
    await expect(company).toHaveText(/Alibaba/);
  });

  test("possible duplicates are offered for review, not merged", async ({ page }) => {
    await page.goto("/dashboard/companies");

    const heading = page.getByRole("heading", { name: "Possible duplicates" });
    // The grouping is a suggestion computed from whatever companies exist at
    // read time, so the section only renders when two names actually look
    // alike. Asserting it unconditionally would fail on a data change that is
    // not a regression — check first, then assert on what it contains.
    if ((await heading.count()) === 0) {
      test.info().annotations.push({
        type: "note",
        description: "no duplicate candidates in the current data — nothing to review",
      });
      return;
    }

    await expect(heading).toBeVisible();
    const section = page.locator("section").filter({ has: heading });
    await expect(section.getByText(/Nothing is ever merged automatically/i)).toBeVisible();

    // A suggestion is only useful if it names the companies it is pairing up,
    // each one openable so a human can make the call.
    const group = section.getByRole("listitem").first();
    await expect(group).toBeVisible();
    const named = group.getByRole("link");
    expect(await named.count(), "a suggestion must name more than one company").toBeGreaterThan(1);
    const hrefs = await named.evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    for (const href of hrefs) expect(href).toMatch(/^\/dashboard\/companies\/.+/);
  });

  test("the top-bar navigates to Companies", async ({ page }) => {
    await page.goto("/dashboard");
    const nav = page.getByRole("navigation");
    const link = nav.getByRole("link", { name: "Companies", exact: true });

    await link.click();
    await page.waitForURL(/\/dashboard\/companies$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Companies" })).toBeVisible();
    // The active section is highlighted and nothing else is.
    await expect(link).toHaveAttribute("aria-current", "page");
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  });
});
