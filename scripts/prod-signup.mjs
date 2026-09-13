// Create a throwaway verification account on a deployed environment.
//
// prod-verify.mjs needs a real session, and the password for the previous
// verification account does not survive a dev-container restart. This makes a
// fresh member account and writes its credentials to the file given in
// PROD_CREDS, so the password is never printed or passed on a command line.
import { chromium } from "playwright";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const BASE = process.env.PROD_URL;
const CREDS = process.env.PROD_CREDS ?? "/tmp/.pv";
if (!BASE) throw new Error("PROD_URL is required");

const email = `prod-verify-${Date.now()}@oovie.dev`;
// No shell metacharacters: this gets read back by another process, not typed.
const password = `Vf${randomBytes(18).toString("base64url")}9z`;

const browser = await chromium.launch();
const page = await browser.newPage();
try {
  await page.goto(`${BASE}/signup`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.locator("input[name=name]").fill("Prod Verify");
  await page.locator("input[name=email]").fill(email);
  await page.locator("input[name=password]").fill(password);
  await page.getByRole("button", { name: /sign up|create/i }).first().click();
  await page.waitForURL(/dashboard/, { timeout: 90_000 });

  writeFileSync(CREDS, `${email}\n${password}\n`, { mode: 0o600 });
  console.log(`signed up ${email}; credentials written to ${CREDS}`);
} finally {
  await browser.close();
}
