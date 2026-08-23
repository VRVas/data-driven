import { test, expect } from "./fixtures";
import { STORAGE_STATE } from "./constants";
import { shot, trackConsole } from "./helpers";

// Every test in this file runs with the persisted authenticated session.
test.use({ storageState: STORAGE_STATE });

const PAGES = [
  { nav: "Pipeline", url: /\/dashboard\/pipeline$/, h1: "Pipeline", eyebrow: "Lead tracker" },
  { nav: "Scoring", url: /\/dashboard\/scoring$/, h1: "Scoring model", eyebrow: "Model" },
  { nav: "Industries", url: /\/dashboard\/industries$/, h1: "Industries", eyebrow: "Segments" },
  { nav: "Whitespace", url: /\/dashboard\/whitespace$/, h1: "Whitespace & TAM", eyebrow: "Market" },
  { nav: "Data Quality", url: /\/dashboard\/quality$/, h1: "Data quality", eyebrow: "Data audit" },
];

test.describe("dashboard", () => {
  test("overview shows KPIs, live pill and the three panels", async ({ page }) => {
    const errors = trackConsole(page);
    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await expect(page.getByText("Command center")).toBeVisible();
    await expect(page.getByText(/live data/i)).toBeVisible();

    // KPI cards (settled numbers under reduced motion)
    await expect(page.getByText("Total pipeline")).toBeVisible();
    await expect(page.getByText("Weighted value")).toBeVisible();
    await expect(page.getByText("Deals closed")).toBeVisible();
    await expect(page.getByText("Scored coverage")).toBeVisible();

    // Panels
    await expect(page.getByRole("heading", { name: "Pipeline by stage" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Priority quadrant" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Industry scorecard" })).toBeVisible();

    await shot(page, "03-dashboard-overview");
    expect(errors, `console errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("top-bar navigates to every section", async ({ page }) => {
    test.slow(); // dev compiles each route on first visit
    await page.goto("/dashboard");
    const nav = page.getByRole("navigation");

    for (const p of PAGES) {
      const link = nav.getByRole("link", { name: p.nav, exact: true });
      await link.click();
      await page.waitForURL(p.url, { timeout: 30_000 });
      await expect(page.getByRole("heading", { level: 1, name: p.h1 })).toBeVisible();
      await expect(page.getByText(p.eyebrow, { exact: true })).toBeVisible();
      // The active section is highlighted and nothing else is.
      await expect(link).toHaveAttribute("aria-current", "page");
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
      await shot(page, `04-nav-${p.nav.toLowerCase().replace(/\s+/g, "-")}`);
    }
  });

  test("active nav follows a nested lead-detail route", async ({ page }) => {
    await page.goto("/dashboard/pipeline/alibaba");
    const nav = page.getByRole("navigation");
    // A lead detail lives under Pipeline, so Pipeline stays lit - not Overview.
    await expect(nav.getByRole("link", { name: "Pipeline", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(nav.getByRole("link", { name: "Overview", exact: true })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("pipeline table filters as you search", async ({ page }) => {
    await page.goto("/dashboard/pipeline");
    const search = page.getByPlaceholder(/search brand/i);
    const counter = page.locator("text=/^\\d+ of \\d+$/");
    await expect(search).toBeVisible();

    // Counts are read off the page: earlier specs move leads between stages, so
    // any hard-coded total is only true until something else runs.
    const initial = (await counter.textContent())!;
    const [shown, total] = initial.match(/^(\d+) of (\d+)$/)!.slice(1).map(Number);
    // Finished deals sit behind the Show filter by default.
    expect(shown).toBeLessThan(total);

    await search.fill("Armani");
    await expect(counter).toHaveText(`1 of ${total}`);
    await expect(page.getByRole("link", { name: /armani/i })).toBeVisible();

    await search.clear();
    await expect(counter).toHaveText(initial);
  });

  test("searching a finished deal offers it rather than coming up empty", async ({ page }) => {
    // Hiding closed deals must not make a client you know exists unfindable.
    await page.goto("/dashboard/pipeline");

    const won = page.getByRole("button", { name: /^Won/ });
    const wonCount = Number((await won.textContent())?.match(/(\d+)\s*$/)?.[1] ?? "0");
    test.skip(wonCount === 0, "no won deals to search for");

    // Take the name from a won deal rather than assuming which brand is closed.
    await won.click();
    const name = (await page.locator("tbody tr td a").first().textContent())!.trim();

    await page.getByRole("button", { name: /^Active/ }).click();
    await page.getByPlaceholder(/search brand/i).fill(name);

    const showAll = page.getByRole("button", { name: /show everything/i }).first();
    await expect(showAll).toBeVisible();
    await showAll.click();
    await expect(page.getByRole("link", { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).first()).toBeVisible();
  });

  test("a lead detail page opens from the pipeline", async ({ page }) => {
    await page.goto("/dashboard/pipeline");
    // Everything first: the lead may or may not be closed depending on what
    // other specs have moved.
    await page.getByRole("button", { name: /^Everything/ }).click();
    await page.getByRole("link", { name: /alibaba/i }).first().click();
    await expect(page).toHaveURL(/\/dashboard\/pipeline\/alibaba/);
    await expect(page.getByText(/alibaba/i).first()).toBeVisible();
    await shot(page, "05-lead-detail");
  });

  test("sign out returns to the public site", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL("**/");
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
  });
});
