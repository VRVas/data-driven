import fs from "node:fs";
import path from "node:path";
import { type Page, expect } from "@playwright/test";
import { SHOTS_DIR, TEST_USER } from "./constants";

/** Save a full-page screenshot into the artifacts folder for manual review. */
export async function shot(page: Page, name: string) {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`), fullPage: true });
}

/** Attach a collector that fails loud on console errors / page crashes. */
export function trackConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/** Log in through the real UI and land on the dashboard. */
export async function login(page: Page, who: { email: string; password: string } = TEST_USER) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(who.email);
  await page.locator('input[name="password"]').fill(who.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
}
