import { test, expect } from "./fixtures";
import { STORAGE_STATE } from "./constants";
import { shot } from "./helpers";

// The seeded account is the founding user → normalised to admin, so these
// specs exercise the admin-only surfaces and the full outreach loop.
test.use({ storageState: STORAGE_STATE });

test.describe("roles + admin surfaces", () => {
  test("topbar shows the Admin badge and every admin page loads", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("Admin", { exact: true })).toBeVisible();

    const pages: [string, string][] = [
      ["/dashboard/reminders", "Reminders"],
      ["/dashboard/outbox", "Outbox"],
      ["/dashboard/team", "Team"],
      ["/dashboard/activity", "Activity"],
    ];
    for (const [path, heading] of pages) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    }
    await shot(page, "20-activity");
  });
});

test.describe("pipeline workflow", () => {
  test("advance a lead through a stage transition", async ({ page }) => {
    await page.goto("/dashboard/pipeline/alibaba");
    const advance = page.getByRole("button", { name: /^→\s/ }).first();
    await expect(advance).toBeVisible();
    const target = ((await advance.textContent()) ?? "").replace("→", "").trim();
    await advance.click();
    // The new stage badge shows once the move lands.
    await expect(page.getByText(target, { exact: true }).first()).toBeVisible();
  });
});

test.describe("saved views", () => {
  test("save the current pipeline view and see its chip", async ({ page }) => {
    await page.goto("/dashboard/pipeline");
    await page.getByRole("button", { name: /save view/i }).click();
    await page.getByPlaceholder("View name").fill("E2E view");
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByRole("button", { name: "E2E view" }).first()).toBeVisible();
  });
});

test.describe("outreach", () => {
  test("compose a message and send it from the lead", async ({ page }) => {
    await page.goto("/dashboard/pipeline/alibaba");
    await page.getByRole("button", { name: /reach out/i }).click();

    // Composer prefills subject + body from the template; supply a recipient.
    await page.getByPlaceholder("name@brand.com").fill("contact@alibaba.com");
    await page.getByRole("button", { name: /save to outbox/i }).click();

    // The lead's Outreach history now shows the message; send it (admin).
    await expect(page.getByRole("heading", { name: "Outreach" })).toBeVisible();
    const send = page.getByRole("button", { name: /^send$/i }).first();
    await expect(send).toBeVisible();
    await send.click();
    await expect(page.getByText("Sent", { exact: true }).first()).toBeVisible();
    await shot(page, "21-outreach-sent");
  });
});

test.describe("copilot", () => {
  test("answers a grounded pipeline question from live tools", async ({ page }) => {
    await page.goto("/dashboard/copilot");
    await expect(page.getByRole("heading", { level: 1, name: "Copilot" })).toBeVisible();

    await page.getByRole("button", { name: "Summarise the pipeline" }).click();

    // The grounded reply cites the seeded lead count and shows the tool it ran.
    await expect(page.getByText(/64/).first()).toBeVisible();
    await expect(page.getByText("pipeline_summary")).toBeVisible();
    await shot(page, "22-copilot");
  });

  test("explains a lead's score on request", async ({ page }) => {
    await page.goto("/dashboard/copilot");
    await page.getByPlaceholder("Ask about the pipeline…").fill("Why is Alibaba scored that way?");
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page.getByText(/Alibaba/).first()).toBeVisible();
    await expect(page.getByText("explain_score")).toBeVisible();
  });

  test("persists a conversation and resumes it from history", async ({ page }) => {
    await page.goto("/dashboard/copilot");
    await page.getByRole("button", { name: "Summarise the pipeline" }).click();
    await expect(page.getByText(/64/).first()).toBeVisible();

    // New chat clears the thread; History resumes the saved one.
    await page.getByRole("button", { name: /new chat/i }).click();
    await page.getByRole("button", { name: /history/i }).click();
    await page.locator("li button").filter({ hasText: "Summarise the pipeline" }).first().click();
    await expect(page.getByText(/64/).first()).toBeVisible();
  });
});
