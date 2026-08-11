import fs from "node:fs";
import path from "node:path";
import { test, expect } from "./fixtures";
import { STORAGE_STATE } from "./constants";

/**
 * UI AUDIT harness — captures an abundant set of full-page screenshots across a
 * wide viewport matrix and every route, for a self-driven responsive + bug pass.
 * Run explicitly:  npx playwright test audit.spec.ts
 * Output:          e2e-artifacts/audit/<route>__<viewport>.png
 */

const AUDIT_DIR = path.join(process.cwd(), "e2e-artifacts/audit");

const VIEWPORTS = [
  { name: "xs-360", width: 360, height: 780 },
  { name: "phone-390", width: 390, height: 844 },
  { name: "phone-430", width: 430, height: 932 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "land-1024", width: 1024, height: 768 },
  { name: "laptop-1280", width: 1280, height: 800 },
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "wide-1920", width: 1920, height: 1080 },
];

const PUBLIC_ROUTES = [
  { slug: "landing", path: "/" },
  { slug: "login", path: "/login" },
  { slug: "signup", path: "/signup" },
];

const DASHBOARD_ROUTES = [
  { slug: "overview", path: "/dashboard" },
  { slug: "pipeline", path: "/dashboard/pipeline" },
  { slug: "lead-detail", path: "/dashboard/pipeline/alibaba" },
  { slug: "agents", path: "/dashboard/agents" },
  { slug: "scoring", path: "/dashboard/scoring" },
  { slug: "industries", path: "/dashboard/industries" },
  { slug: "whitespace", path: "/dashboard/whitespace" },
  { slug: "quality", path: "/dashboard/quality" },
  { slug: "companies", path: "/dashboard/companies" },
  { slug: "copilot", path: "/dashboard/copilot" },
  { slug: "reminders", path: "/dashboard/reminders" },
  { slug: "outbox", path: "/dashboard/outbox" },
  { slug: "activity", path: "/dashboard/activity" },
  { slug: "team", path: "/dashboard/team" },
];

async function settle(page: import("@playwright/test").Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
}

async function capture(page: import("@playwright/test").Page, slug: string, vp: string) {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(AUDIT_DIR, `${slug}__${vp}.png`), fullPage: true });
}

test.describe("audit — public", () => {
  for (const route of PUBLIC_ROUTES) {
    for (const vp of VIEWPORTS) {
      test(`${route.slug} @ ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(route.path, { waitUntil: "networkidle" }).catch(() => {});
        await settle(page);
        await capture(page, route.slug, vp.name);
      });
    }
  }
});

test.describe("audit — dashboard", () => {
  test.use({ storageState: STORAGE_STATE });

  for (const route of DASHBOARD_ROUTES) {
    for (const vp of VIEWPORTS) {
      test(`${route.slug} @ ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(route.path, { waitUntil: "networkidle" }).catch(() => {});
        await settle(page);
        await capture(page, route.slug, vp.name);
      });
    }
  }
});

test("audit index sanity", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/OOVIE/);
});
