import { test, expect } from "./fixtures";
import { STORAGE_STATE } from "./constants";
import { setBadge, shot } from "./helpers";

// The seeded account is the founding user → normalised to admin, so these
// specs exercise the admin-only surfaces and the full outreach loop.
test.use({ storageState: STORAGE_STATE });

test.describe("roles + admin surfaces", () => {
  test("the topbar badge agrees with the Team panel, and every admin page loads", async ({ page }) => {
    // This used to assert the literal string "Admin", which came from the legacy
    // role claim on the session and was wrong for anyone granted admin after
    // their last sign-in. The badge reads the profiles now, so the assertion
    // that matters is that it says the same thing the Team panel says.
    await page.goto("/dashboard/team");
    const mine = page.getByRole("row").filter({ hasText: "E2E" }).first();
    const onTeamPage = (await mine.count()) > 0 ? await mine.innerText() : "";

    await page.goto("/dashboard");
    const badge = page.getByText("Administrator", { exact: true }).first();
    await expect(badge).toBeVisible();
    if (onTeamPage) expect(onTeamPage).toContain("Administrator");

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

    // The stage used to have its own panel of "-> Stage" buttons below the
    // headline metrics, which meant it was on the page twice. The badge under
    // the name is the control now.
    const stage = page.getByLabel("Pipeline stage", { exact: true });
    await expect(stage).toBeVisible();

    const current = await stage.inputValue();
    const options = await stage.locator("option").evaluateAll((els) =>
      els.map((el) => (el as HTMLOptionElement).value),
    );
    const target = options.find((o) => o !== current);
    expect(target, "a lead with no legal next stage cannot exercise this").toBeTruthy();

    await setBadge(page, "Pipeline stage", target!);
    await page.reload();
    await expect(page.getByLabel("Pipeline stage", { exact: true })).toHaveValue(target!);

    // Put it back. Alibaba is seeded data that other specs read, and the old
    // version of this test left it on whatever stage it happened to click.
    const back = page.getByLabel("Pipeline stage", { exact: true });
    if ((await back.locator(`option[value="${current}"]`).count()) > 0) {
      await setBadge(page, "Pipeline stage", current);
    }
  });
});

test.describe("saved views", () => {
  test("save the current pipeline view and see its chip", async ({ page }) => {
    await page.goto("/dashboard/pipeline");
    await page.getByRole("button", { name: /save view/i }).click();
    await page.getByPlaceholder("View name").fill("E2E view");
    await page.getByRole("button", { name: /^save$/i }).click();
    const chip = page.getByRole("button", { name: "E2E view" }).first();
    await expect(chip).toBeVisible();

    // Saved views persist per user, so without this every run left another
    // chip behind and the pipeline header filled up with test debris.
    await chip.locator("xpath=following-sibling::*[1]").click();
    await expect(page.getByRole("button", { name: "E2E view" })).toHaveCount(0);
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

test.describe("export + copy", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("downloads the pipeline as CSV", async ({ page }) => {
    await page.goto("/dashboard/pipeline");
    await page.getByRole("button", { name: "Export" }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: /Download CSV/ }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^pipeline-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  test("downloads the pipeline as Excel (.xlsx)", async ({ page }) => {
    await page.goto("/dashboard/pipeline");
    await page.getByRole("button", { name: "Export" }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: /Download Excel/ }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^pipeline-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  test("downloads the pipeline as PDF", async ({ page }) => {
    await page.goto("/dashboard/pipeline");
    await page.getByRole("button", { name: "Export" }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: /Download PDF/ }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^pipeline-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  test("copies a copilot answer and toasts", async ({ page }) => {
    await page.goto("/dashboard/copilot");
    await page.getByRole("button", { name: "Summarise the pipeline" }).click();
    await expect(page.getByText(/64/).first()).toBeVisible();
    await page.getByRole("button", { name: "Copy", exact: true }).first().click();
    await expect(page.getByText("Copied", { exact: true })).toBeVisible();
  });
});

test.describe("command palette", () => {
  test("opens with the keyboard and jumps to a section", async ({ page }) => {
    await page.goto("/dashboard");
    await page.keyboard.press("Control+k");
    const search = page.getByRole("combobox", { name: "Command palette search" });
    await expect(search).toBeVisible();
    await shot(page, "23-command-palette");
    await search.fill("scoring");
    await search.press("Enter");
    await expect(page).toHaveURL(/\/dashboard\/scoring$/);
  });

  test("searches a lead by name and opens it", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Open command palette" }).click();
    const search = page.getByRole("combobox", { name: "Command palette search" });
    await search.fill("alibaba");
    await page.getByRole("option", { name: /alibaba/i }).first().click();
    await expect(page).toHaveURL(/\/dashboard\/pipeline\/alibaba$/);
  });
});
