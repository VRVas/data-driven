import { test, expect } from "./fixtures";
import { shot, trackConsole } from "./helpers";

/**
 * Public landing page - the showcase moment. Verifies the hero, the KPI strip
 * (settled animated numbers), the six-lens feature grid, the CTAs and that the
 * page renders clean (no console errors).
 */
test.describe("landing", () => {
  test("hero, KPIs and features render clean", async ({ page }) => {
    const errors = trackConsole(page);
    await page.goto("/");

    // Hero headline + eyebrow
    await expect(page.getByRole("heading", { level: 1 })).toContainText("operating system");
    await expect(page.getByText(/Business Development/i).first()).toBeVisible();

    // KPI strip - reduced motion settles the count-ups to their final values
    await expect(page.getByText("Pipeline leads")).toBeVisible();
    await expect(page.getByText("45 fully scored")).toBeVisible();
    await expect(page.getByText("Weighted value")).toBeVisible();
    await expect(page.getByText("Deals closed")).toBeVisible();
    await expect(page.getByText("Budget in play")).toBeVisible();

    // Feature grid - exactly six lenses (h3 per card)
    await expect(page.getByRole("heading", { level: 2 })).toContainText("Six lenses");
    await expect(page.getByRole("heading", { level: 3 })).toHaveCount(6);
    for (const t of ["Pipeline & CRM", "Lead scoring", "Industry heat-map", "AI copilot"]) {
      await expect(page.getByRole("heading", { level: 3, name: t })).toBeVisible();
    }

    // Footer
    await expect(page.getByText("Business Development Intelligence")).toBeVisible();

    await shot(page, "01-landing");
    expect(errors, `console errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("primary CTA points into the platform", async ({ page }) => {
    await page.goto("/");
    const cta = page.getByRole("link", { name: /enter the platform/i });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", "/dashboard");
    await expect(page.getByRole("link", { name: /scoring model/i })).toHaveAttribute(
      "href",
      "/dashboard/scoring",
    );
  });

  test("CTA is gated behind auth when logged out", async ({ page }) => {
    await page.goto("/");
    const cta = page.getByRole("link", { name: /enter the platform/i });
    // Wait for the link to settle before clicking: the hero animates it in, and
    // a click dispatched mid-hydration lands on a node React is still swapping.
    await expect(cta).toBeVisible();
    await cta.click();
    // This is a client-side navigation to /dashboard that middleware bounces to
    // /login, so the URL stays on "/" for the whole round trip. Under a full
    // suite run that round trip has exceeded the 10s default - the assertion is
    // unchanged, only the patience.
    await page.waitForURL(/\/login/, { timeout: 30_000 });
  });

  test("has a document title", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/OOVIE/i);
  });
});
