import { test, expect } from "./fixtures";
import { TEST_USER } from "./constants";
import { shot } from "./helpers";

/**
 * Authentication & route protection. These run logged-out (no storageState).
 */
test.describe("auth", () => {
  test("login page renders the form", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle(/Sign in/i);
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    await shot(page, "02-login");
  });

  test("signup page renders the form", async ({ page }) => {
    await page.goto("/signup");
    await expect(page).toHaveTitle(/Create account/i);
    await expect(page.locator('input[name="name"]')).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /create account/i })).toBeVisible();
  });

  test("wrong password is rejected", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(TEST_USER.email);
    await page.locator('input[name="password"]').fill("definitely-wrong");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("protected route redirects to login when logged out", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/dashboard/pipeline");
    await expect(page).toHaveURL(/\/login/);
  });

  test("valid credentials sign in and reach the dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(TEST_USER.email);
    await page.locator('input[name="password"]').fill(TEST_USER.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  });
});
