import { test as setup } from "@playwright/test";
import { STORAGE_STATE } from "./constants";
import { login } from "./helpers";

// Every route the suite touches — warmed once here (authenticated, sequential)
// so `next dev` compiles them ahead of time instead of in a burst mid-test.
const ROUTES = [
  "/",
  "/login",
  "/signup",
  "/dashboard",
  "/dashboard/pipeline",
  "/dashboard/agents",
  "/dashboard/scoring",
  "/dashboard/industries",
  "/dashboard/whitespace",
  "/dashboard/quality",
  "/dashboard/pipeline/alibaba",
];

/**
 * Authenticate once and persist the session so the dashboard specs can reuse it
 * without re-running the login form every test.
 */
setup("authenticate", async ({ page }) => {
  setup.setTimeout(180_000); // includes warming every route on a cold dev server
  await login(page);
  // The product tour auto-starts for first-time users; mark it done in the shared
  // session so functional specs aren't covered by the tour overlay.
  await page.evaluate(() => localStorage.setItem("oovie.tour.v1.done", "1"));
  await page.context().storageState({ path: STORAGE_STATE });

  // Pre-compile every route via lightweight HTTP requests (the browser context's
  // session cookie rides along, so protected pages compile too) — no renderer,
  // so this warms `next dev` without the memory cost of rendering each page.
  for (const route of ROUTES) {
    await page.request.get(route).catch(() => undefined);
  }
});
