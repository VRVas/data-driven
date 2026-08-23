import { test, expect } from "./fixtures";
import { STORAGE_STATE } from "./constants";

/**
 * Comments on a lead, end to end.
 *
 * What only a live server can show: that a comment is stored and attributed,
 * that it survives a reload, that it appears on the pipeline list as well as
 * the record, and that the author can take their own back.
 *
 * Everything it writes is prefixed so teardown can find it. The E2E account is
 * a member, and members cannot delete leads, so nothing here creates one.
 */

test.use({ storageState: STORAGE_STATE });
test.describe.configure({ mode: "serial" });

const LEAD = "/dashboard/pipeline/alibaba";
const thread = (page: import("@playwright/test").Page) => page.getByTestId("comment-thread");

async function postComment(page: import("@playwright/test").Page, body: string) {
  await page.goto(LEAD);
  await thread(page).getByPlaceholder("What happened").fill(body);
  await thread(page).getByRole("button", { name: "Comment", exact: true }).click();
  await expect(thread(page).getByText(body, { exact: false })).toBeVisible();
}

test.describe("comments", () => {
  test("the lead page shows notes and the discussion as separate things", async ({ page }) => {
    await page.goto(LEAD);
    // Notes render even when empty: an invisible field and an absent one look
    // the same, and the first is the bug this feature exists to fix.
    await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Comments" })).toBeVisible();
    await expect(thread(page).getByPlaceholder("What happened")).toBeVisible();
  });

  test("a comment is stored, attributed and dated", async ({ page }) => {
    await postComment(page, "ZZ probe - they asked for phased pricing");

    const entry = thread(page).locator("li", { hasText: "ZZ probe - they asked" }).first();
    await expect(entry).toContainText(/just now|minutes? ago/);
    // The author is the point: a note nobody signed is what we are replacing.
    await expect(entry).toContainText("E2E Tester");

    await page.reload();
    await expect(thread(page).getByText("ZZ probe - they asked for phased pricing")).toBeVisible();
  });

  test("it refuses an empty comment rather than storing a blank turn", async ({ page }) => {
    await page.goto(LEAD);
    await thread(page).getByRole("button", { name: "Comment", exact: true }).click();
    // Required, so the browser blocks it and nothing reaches the server.
    await expect(thread(page).getByPlaceholder("What happened")).toBeFocused();
  });

  test("a second comment does not replace the first", async ({ page }) => {
    await postComment(page, "ZZ probe - procurement is the blocker");
    await expect(thread(page).getByText("ZZ probe - they asked for phased pricing")).toBeVisible();
    await expect(thread(page).getByText("ZZ probe - procurement is the blocker")).toBeVisible();
    // Newest first: a thread is read from the top.
    const first = thread(page).locator("ol > li").first();
    await expect(first).toContainText("procurement is the blocker");
  });

  test("the count reaches the pipeline list, next to the lead", async ({ page }) => {
    await page.goto("/dashboard/pipeline");
    // Alibaba is a won deal, and the list defaults to active only.
    await page.getByRole("button", { name: "Everything" }).click();
    await page.getByPlaceholder("Search brand, POC, notes").fill("Alibaba");
    const row = page.locator("tr", { hasText: "Alibaba" }).first();
    await expect(row.locator("[title*='comment']")).toBeVisible();
  });

  test("the author can take their own comment back", async ({ page }) => {
    await page.goto(LEAD);
    const entry = thread(page).locator("li", { hasText: "ZZ probe - procurement" }).first();
    await entry.getByRole("button", { name: "Remove comment" }).click();
    await expect(thread(page).getByText("ZZ probe - procurement is the blocker")).toHaveCount(0);
    // And only that one.
    await expect(thread(page).getByText("ZZ probe - they asked for phased pricing")).toBeVisible();
  });
});
