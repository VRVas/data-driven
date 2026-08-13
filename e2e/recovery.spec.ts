import { test, expect } from "./fixtures";
import { TEST_USER } from "./constants";
import fs from "node:fs";
import path from "node:path";

/**
 * Account recovery, driven through the real pages.
 *
 * Deliberately unauthenticated — the point of these flows is that someone with
 * no session can reach them.
 */

// Issuing is rate limited per address, so without this the fifth run in an hour
// would compare a cooldown message against a success one and fail for a reason
// that has nothing to do with the property under test.
test.beforeAll(() => {
  fs.rmSync(path.join(process.cwd(), ".data/challenges.json"), { force: true });
});

test.describe("password reset", () => {
  test("the login page offers a way out when you forget", async ({ page }) => {
    await page.goto("/login");
    const forgot = page.getByRole("link", { name: /forgot password/i });
    await expect(forgot).toBeVisible();
    await forgot.click();
    await expect(page).toHaveURL(/\/forgot/);
  });

  test("a registered address and an unknown one get the same answer", async ({ page }) => {
    // If these differed, the form would be a way to discover who has an account.
    // Compare the visible notice only: the page also carries an RSC payload full
    // of dev-only build internals that differs run to run.
    const noticeFor = async (email: string) => {
      await page.goto("/forgot");
      await page.getByLabel(/email/i).fill(email);
      await page.getByRole("button", { name: /reset link/i }).click();
      // Scoped to the form: the global toast region is also role=status and,
      // being empty, silently matched first.
      const notice = page.locator('form [role="status"], form [role="alert"]').first();
      await expect(notice).toBeVisible({ timeout: 20_000 });
      return ((await notice.textContent()) ?? "").trim();
    };

    const known = await noticeFor(TEST_USER.email);
    const unknown = await noticeFor("definitely-not-registered@example.com");
    expect(known).toBe(unknown);
    expect(known.length).toBeGreaterThan(0);
  });

  test("a reset link with a junk token is refused", async ({ page }) => {
    await page.goto(`/reset?token=not-a-real-token&email=${encodeURIComponent(TEST_USER.email)}`);
    await page.getByLabel(/new password/i).fill("BrandNewPassword123!");
    await page.getByRole("button", { name: /save new password/i }).click();

    // It must refuse rather than quietly accept and let us in.
    await expect(page.locator(String.raw`form [role="alert"]`)).toBeVisible({ timeout: 20_000 });
    await expect(page).not.toHaveURL(/\/dashboard/);
  });

  test("an incomplete link is not treated as a reset attempt", async ({ page }) => {
    await page.goto("/reset");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/incomplete/i);
    await expect(page.getByLabel(/new password/i)).toHaveCount(0);
  });
});

test.describe("sign-in by emailed code is off by default", () => {
  test("the login page does not advertise it", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("link", { name: /email me a code/i })).toHaveCount(0);
  });

  test("the route is not reachable by typing the URL", async ({ page }) => {
    // A hidden link is not an access control; the page itself has to refuse.
    const res = await page.goto("/login/code");
    expect(res?.status()).toBe(404);
  });
});
