import { test, expect } from "./fixtures";
import { STORAGE_STATE } from "./constants";

/**
 * The dev overlay must report nothing.
 *
 * Playwright's own console listener is not enough: Next routes React's
 * console.error into its overlay, so a hydration error can sit on a page for
 * weeks while every console assertion passes. One did - a stray run of spaces
 * between two header cells put a whitespace text node inside a <tr> - and it
 * surfaced only because somebody noticed a small red badge in a screenshot.
 *
 * Reading the badge instead catches the whole class on every route it visits.
 * E2E runs against `next dev` by design, so the overlay is always there to ask.
 * The COUNT has to be parsed rather than the badge merely located: it renders
 * "0 Issue" when everything is fine, which any presence check fails on.
 */

test.use({ storageState: STORAGE_STATE, viewport: { width: 1440, height: 900 } });

async function issueCount(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    const parts: string[] = [];
    document.querySelectorAll("nextjs-portal").forEach((el) => {
      const sr = (el as HTMLElement & { shadowRoot?: ShadowRoot }).shadowRoot;
      if (!sr) return;
      sr.querySelectorAll("*").forEach((n) => {
        if (n.tagName === "STYLE" || n.children.length) return;
        const t = (n.textContent ?? "").trim();
        if (t) parts.push(t);
      });
    });
    const found = [...parts.join(" ").matchAll(/(\d+)\s*Issues?/g)].map((m) => Number(m[1]));
    return found.length ? Math.max(...found) : 0;
  });
}

const ROUTES = [
  "/dashboard",
  "/dashboard/pipeline",
  "/dashboard/pipeline/alibaba",
  "/dashboard/companies",
  "/dashboard/scoring",
  "/dashboard/industries",
  "/dashboard/whitespace",
  "/dashboard/quality",
  "/dashboard/reminders",
  "/dashboard/copilot",
];

for (const route of ROUTES) {
  test(`${route} renders without a console or hydration error`, async ({ page }) => {
    await page.goto(route);
    // Hydration runs after the first paint, and the badge appears after that.
    await page.waitForTimeout(1500);
    expect(await issueCount(page), `dev overlay reported an issue on ${route}`).toBe(0);
  });
}

test("opening the lead editor does not fault", async ({ page }) => {
  await page.goto("/dashboard/pipeline");
  await page.getByRole("button", { name: "+ New lead" }).click();
  await page.getByRole("button", { name: "What Commercial value (€) is for" }).click();
  await page.waitForTimeout(1200);
  expect(await issueCount(page)).toBe(0);
});
