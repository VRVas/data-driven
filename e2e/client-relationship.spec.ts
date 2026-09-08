import { test, expect } from "./fixtures";
import { STORAGE_STATE } from "./constants";
import { setBadge, shot, trackConsole } from "./helpers";

/**
 * The client relationship, now that Companies is not a page.
 *
 * It used to be two screens: /dashboard/companies/co-alibaba and
 * /dashboard/pipeline/alibaba, showing overlapping facts about the same client.
 * They are one screen, and these tests hold that line - both that the merged
 * page carries everything the company page did, and that the old URLs still
 * land somewhere sensible rather than 404ing.
 *
 * The seeded E2E account is the founding user, so it holds the administrator
 * profile and can reach every deal here.
 */
test.use({ storageState: STORAGE_STATE });

test.describe("client relationship on the lead page", () => {
  test("a lead carries its client's whole book, not just this deal", async ({ page }) => {
    test.slow(); // dev compiles the lead route on the first visit
    const errors = trackConsole(page);
    await page.goto("/dashboard/pipeline/alibaba");

    await expect(page.getByRole("heading", { level: 1, name: "Alibaba" })).toBeVisible();

    // The client section: the rollups the company page used to own.
    const client = page.locator("section").filter({ has: page.getByRole("heading", { name: "Alibaba", exact: true }) });
    await expect(client).toHaveCount(1);
    for (const label of ["Lifetime value", "Repeat value", "Open pipeline", "Deal win rate"]) {
      await expect(client.getByText(label, { exact: true }), `rollup "${label}"`).toBeVisible();
    }

    // Every deal with this client is listed, and the one you are on says so
    // rather than linking to itself.
    await expect(client.getByRole("table")).toBeVisible();
    await expect(client.getByText("this lead")).toBeVisible();
    await expect(client.locator('a[href="/dashboard/pipeline/alibaba"]')).toHaveCount(0);

    await shot(page, "30-lead-client");
    expect(errors, `console errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("the retired company URL lands on a real lead", async ({ page }) => {
    await page.goto("/dashboard/companies/co-alibaba");
    // Bookmarks and the copilot's older answers still point here, so it
    // redirects to the client's most relevant deal rather than 404ing.
    await page.waitForURL(/\/dashboard\/pipeline\/[^/]+$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("the retired companies list lands on the pipeline", async ({ page }) => {
    await page.goto("/dashboard/companies");
    await page.waitForURL(/\/dashboard\/pipeline$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Pipeline" })).toBeVisible();
  });

  test("Companies is gone from the nav", async ({ page }) => {
    await page.goto("/dashboard");
    const nav = page.getByRole("navigation");
    await expect(nav.getByRole("link", { name: "Companies", exact: true })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Pipeline", exact: true })).toBeVisible();
  });

  test("possible duplicates are reviewed on Data Quality, not merged", async ({ page }) => {
    await page.goto("/dashboard/quality");

    // The section renders either way; the heading says which state it is in.
    const heading = page.getByRole("heading", { name: /possible duplicate clients|Merge clients/i });
    await expect(heading).toBeVisible();
    const section = page.locator("section").filter({ has: heading });

    const groups = section.getByRole("listitem");
    if ((await groups.count()) === 0) {
      test.info().annotations.push({
        type: "note",
        description: "no duplicate candidates in the current data - nothing to review",
      });
      return;
    }

    await expect(section.getByText(/Nothing is ever merged automatically/i)).toBeVisible();

    // A suggestion is only useful if it names the clients it is pairing up, and
    // each name has to open something now that companies have no page.
    const named = groups.first().getByRole("link");
    expect(await named.count(), "a suggestion must name more than one client").toBeGreaterThan(1);
    const hrefs = await named.evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    for (const href of hrefs) expect(href).toMatch(/^\/dashboard\/pipeline\/.+/);
  });
});

test.describe("the lead header edits in place", () => {
  test("stage, priority and industry are dropdowns, and one of them sticks", async ({ page }) => {
    await page.goto("/dashboard/pipeline/alibaba");

    // The separate "Pipeline stage" panel is gone - the badge is the control.
    await expect(page.getByText("Pipeline stage", { exact: true })).toHaveCount(0);

    const priority = page.getByLabel("Priority", { exact: true });
    await expect(priority).toBeVisible();
    await expect(page.getByLabel("Industry", { exact: true })).toBeVisible();

    const before = await priority.inputValue();
    const next = before === "High" ? "Medium" : "High";
    await setBadge(page, "Priority", next);

    await page.reload();
    await expect(page.getByLabel("Priority", { exact: true })).toHaveValue(next);

    // Leave the fixture as it was found.
    await setBadge(page, "Priority", before);
  });

  test("comments are gone from the lead page", async ({ page }) => {
    await page.goto("/dashboard/pipeline/alibaba");
    await expect(page.getByRole("heading", { name: /^Discussion$|^Comments$/i })).toHaveCount(0);
    await expect(page.getByPlaceholder(/comment/i)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
  });
});
