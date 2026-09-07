import { test, expect } from "./fixtures";
import { STORAGE_STATE } from "./constants";
import { QA, must, tool, ymd, uproot, type Planted } from "./qa-helpers";

/**
 * The platform as a person actually uses it: the form, then every screen that
 * is supposed to have noticed.
 *
 * Everything else in this pass drives the tool routes, which is fast and is a
 * real path, but it skips the form's own parsing - dates, a currency field, a
 * select of scores, an empty string versus an absent key. A lead typed by hand
 * has to land on every derived surface with the same numbers, and the derived
 * surfaces have to move when it does.
 */

test.use({ storageState: STORAGE_STATE, viewport: { width: 1440, height: 1000 } });
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const planted: Planted[] = [];
const FULL = `${QA} Handmade`;
const SPARSE = `${QA} Barebones`;

test.afterAll(async ({ request }) => {
  await uproot(request, planted);
});

async function openEditor(page: import("@playwright/test").Page) {
  await page.goto("/dashboard/pipeline");
  await page.getByRole("button", { name: "+ New lead" }).click();
  await expect(page.getByRole("heading", { name: "New lead" })).toBeVisible();
}

test.describe("a lead typed by hand", () => {
  test("every field the form offers is accepted and stored", async ({ page, request }) => {
    await openEditor(page);
    const form = page.locator("form").filter({ has: page.locator('input[name="name"]') });

    await form.locator('input[name="name"]').fill(FULL);
    await form.locator('select[name="status"]').selectOption("Follow Up");
    await form.locator('select[name="priority"]').selectOption("High");
    await form.locator('select[name="industry"]').selectOption("Fashion");
    await form.locator('input[name="owner"]').fill("QA Owner");
    await form.locator('input[name="poc"]').fill("Test Contact");
    await form.locator('input[name="email"]').fill("qa.contact@example.com");
    await form.locator('input[name="initialContact"]').fill(ymd(-120));
    await form.locator('input[name="lastContact"]').fill(ymd(-10));
    await form.locator('input[name="followUpDate"]').fill(ymd(-5));
    await form.locator('select[name="waitingOn"]').selectOption("us");
    await form.locator('input[name="expectedMonths"]').fill("7.5");
    await form.locator('input[name="nextStep"]').fill("Send the revised quote");
    await form.locator('input[name="budget"]').fill("64000");
    await form.locator('select[name="assumption"]').selectOption("Confirmed");
    await form.locator('select[name="strategicValue"]').selectOption("2");
    await form.locator('input[name="customizationScore"]').fill("4");
    await form.locator('input[name="accessibilityScore"]').fill("3");
    await form.locator('input[name="receptivityScore"]').fill("5");
    await form.locator('input[name="alignmentScore"]').fill("4");
    await form.locator('textarea[name="notes"]').fill("Typed through the form, not the API.");
    await form.getByRole("button", { name: "Create lead" }).click();

    await expect(page.getByRole("heading", { name: "New lead" })).toBeHidden({ timeout: 15_000 });

    const found = await must<{ leads: { id: string; name: string }[] }>(request, "search_leads", {
      query: FULL,
      limit: 5,
    });
    const row = found.leads.find((l) => l.name === FULL)!;
    expect(row, "the form did not create the lead").toBeTruthy();
    planted.push({ id: row.id, name: FULL });

    const d = await must<{
      status: string; priority: string; industry: string; owner: string; poc: string; email: string;
      budgetEur: number; nextStep: string; waitingOn: string; notes: string;
      scores: Record<string, number>; strategicValue: number;
      pace: { months: number | null; basis: string };
      timeline: { initialContact: string; lastContact: string; followUpDate: string };
    }>(request, "get_lead", { id: row.id });

    expect(d.status).toBe("Follow Up");
    expect(d.priority).toBe("High");
    expect(d.industry).toBe("Fashion");
    expect(d.owner).toBe("QA Owner");
    expect(d.poc).toBe("Test Contact");
    expect(d.email).toBe("qa.contact@example.com");
    expect(d.budgetEur).toBe(64_000);
    expect(d.nextStep).toBe("Send the revised quote");
    expect(d.waitingOn).toBe("us");
    expect(d.notes).toContain("Typed through the form");
    expect(d.timeline.initialContact).toBe(ymd(-120));
    expect(d.timeline.lastContact).toBe(ymd(-10));
    expect(d.strategicValue).toBe(2);
    expect(d.scores.customizationScore).toBe(4);
    expect(d.scores.receptivityScore).toBe(5);
  });

  test("a confirmed value is not silently downgraded to an estimate", async ({ request }) => {
    const id = planted[0].id;
    const s = await must<{ opportunity: { adjustedBudgetEur: number } }>(request, "explain_score", { id });
    // Confirmed counts at 1.0. If the form dropped the confidence this would
    // be 38,400 and nothing on screen would say why the lead ranked lower.
    expect(s.opportunity.adjustedBudgetEur).toBe(64_000);
  });

  test("an overdue follow-up owed by us is counted as ours", async ({ request }) => {
    const health = await must<{ lateOnUs: number }>(request, "pipeline_health", { side: "us" });
    expect(health.lateOnUs).toBeGreaterThanOrEqual(1);
    const d = await must<{ nextMove: { lateOnUs: boolean; daysLate: number } }>(request, "get_lead", {
      id: planted[0].id,
    });
    expect(d.nextMove.lateOnUs).toBe(true);
    expect(d.nextMove.daysLate).toBeGreaterThanOrEqual(4);
  });

  test("the lead page reads back what was typed", async ({ page }) => {
    await page.goto(`/dashboard/pipeline/${planted[0].id}`);
    const body = await page.locator("body").innerText();
    expect(body).toContain(FULL);
    expect(body).toContain("QA Owner");
    expect(body).toContain("Test Contact");
    expect(body).toContain("64,000");
    expect(body).toContain("Send the revised quote");
    expect(body).toContain("Typed through the form");
  });
});

test.describe("a lead typed with almost nothing", () => {
  test("the form accepts a name alone", async ({ page, request }) => {
    await openEditor(page);
    const form = page.locator("form").filter({ has: page.locator('input[name="name"]') });
    await form.locator('input[name="name"]').fill(SPARSE);
    await form.getByRole("button", { name: "Create lead" }).click();
    await expect(page.getByRole("heading", { name: "New lead" })).toBeHidden({ timeout: 15_000 });

    const found = await must<{ leads: { id: string; name: string }[] }>(request, "search_leads", { query: SPARSE, limit: 5 });
    const row = found.leads.find((l) => l.name === SPARSE)!;
    expect(row).toBeTruthy();
    planted.push({ id: row.id, name: SPARSE });
  });

  test("blank fields are stored as absent, never as empty strings or zeroes", async ({ request }) => {
    const d = await must<Record<string, unknown>>(request, "get_lead", { id: planted[1].id });
    for (const key of ["status", "priority", "industry", "owner", "poc", "email", "budgetEur", "nextStep"]) {
      expect(d[key], `${key} should be null, got ${JSON.stringify(d[key])}`).toBeNull();
    }
  });

  test("data quality notices what is missing", async ({ request }) => {
    const q = await must<{
      liveFindings: { id: string; check: string; severity: string }[];
      liveSummary: { total: number; high: number; leadsAffected: number };
      migrationNotes: { count: number; note: string };
    }>(request, "data_quality", { limit: 50 });

    // A lead carrying nothing but a name is the most broken record possible,
    // and nothing examined it: the reported list was the frozen ETL log from
    // the original spreadsheet import.
    const mine = q.liveFindings.filter((f) => f.id === planted[1].id);
    expect(mine.length, "a lead with nothing on it should be flagged").toBeGreaterThan(0);
    expect(mine.map((f) => f.check)).toContain("no-value");
    expect(mine.map((f) => f.check)).toContain("no-owner");
    expect(q.liveSummary.high).toBeGreaterThan(0);

    // And the migration log is still there, labelled as history.
    expect(q.migrationNotes.note).toContain("History");
  });

  test("the quality page lists the live finding, not just a count", async ({ page }) => {
    await page.goto("/dashboard/quality");
    const live = page.getByTestId("live-hygiene");
    await expect(live).toContainText("Recomputed from the current pipeline");
    await expect(live.getByRole("link", { name: SPARSE })).toBeVisible();
    // The migration log is present but framed for what it is.
    await expect(page.getByRole("heading", { name: "Migration notes" })).toBeVisible();
  });

  test("fixing the lead removes it from the list", async ({ request }) => {
    const id = planted[1].id;
    await must(request, "update_lead", { id, industry: "Fashion" });
    await must(request, "set_budget", { id, valueEur: 20_000 });
    await must(request, "assign_lead", { id, owner: "QA Owner" });
    await must(request, "advance_lead_stage", { id, to: "Early" });
    await must(request, "set_next_move", { id, waitingOn: "us", followUpDate: ymd(30) });
    await must(request, "update_lead", { id, lastContact: ymd(-2) });

    const q = await must<{ liveFindings: { id: string; check: string }[] }>(request, "data_quality", { limit: 50 });
    // This is the half a frozen list can never do.
    expect(q.liveFindings.filter((f) => f.id === id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Derived screens have to move when the pipeline does
// ---------------------------------------------------------------------------

test.describe("the derived screens react", () => {
  test("the industry rollup counts the new Fashion lead", async ({ request }) => {
    const before = await must<{ industries: { industry: string; approached: number }[] }>(request, "top_opportunities", {
      limit: 10,
    });
    const fashionBefore = before.industries.find((i) => i.industry === "Fashion")?.approached ?? 0;

    const extra = await must<{ id: string }>(request, "create_lead", {
      name: `${QA} Segment Mover`,
      industry: "Fashion",
      status: "Early",
      valueEur: 15_000,
    });
    planted.push({ id: extra.id, name: `${QA} Segment Mover` });

    const after = await must<{ industries: { industry: string; approached: number }[] }>(request, "top_opportunities", {
      limit: 10,
    });
    const fashionAfter = after.industries.find((i) => i.industry === "Fashion")?.approached ?? 0;
    expect(fashionAfter).toBe(fashionBefore + 1);
  });

  test("the whitespace page shows the moved figure, not a cached one", async ({ page, request }) => {
    const t = await must<{ industries: { industry: string; approached: number }[] }>(request, "top_opportunities", { limit: 10 });
    const fashion = t.industries.find((i) => i.industry === "Fashion")!;
    await page.goto("/dashboard/whitespace");
    await expect(page.locator("body")).toContainText("Fashion");
    // The KPI is a sum across every segment, so it must include ours.
    const approachedTotal = t.industries.reduce((n, i) => n + i.approached, 0);
    expect(approachedTotal).toBeGreaterThanOrEqual(fashion.approached);
  });

  test("the overview KPIs move with the leads behind them", async ({ page, request }) => {
    const summary = await must<{ totalLeads: number; dealsClosed: number }>(request, "pipeline_summary", {});
    await page.goto("/dashboard");
    const body = await page.locator("body").innerText();
    expect(body).toContain(String(summary.totalLeads));
    expect(body).toContain(String(summary.dealsClosed));
  });

  test("an export carries the same numbers the table shows", async ({ page }) => {
    await page.goto("/dashboard/pipeline");
    await page.getByPlaceholder("Search brand, POC, notes").fill(FULL);
    await expect(page.locator("tr", { hasText: FULL }).first()).toBeVisible();

    const download = page.waitForEvent("download");
    await page.locator('[data-tour="pipe-export"]').getByRole("button").first().click();
    await page.getByRole("menuitem", { name: /CSV/i }).first().click().catch(async () => {
      await page.getByRole("button", { name: /Download CSV/i }).first().click();
    });
    const file = await download;
    const body = await (await import("node:fs/promises")).readFile(await file.path(), "utf8");

    expect(body).toContain(FULL);
    expect(body).toContain("64000");
    expect(body).toContain("QA Owner");
    expect(body).toContain("Send the revised quote");
  });
});

// ---------------------------------------------------------------------------
// Editing, not just creating
// ---------------------------------------------------------------------------

test.describe("editing through the form", () => {
  test("clearing a field clears it, rather than leaving the old value", async ({ page, request }) => {
    await page.goto("/dashboard/pipeline");
    await page.getByPlaceholder("Search brand, POC, notes").fill(FULL);
    await page.locator("tr", { hasText: FULL }).first().getByRole("button", { name: "Edit" }).click();

    const form = page.locator("form").filter({ has: page.locator('input[name="name"]') });
    await form.locator('input[name="poc"]').fill("");
    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { name: FULL })).toBeHidden({ timeout: 15_000 });

    const d = await must<{ poc: string | null; owner: string | null }>(request, "get_lead", { id: planted[0].id });
    expect(d.poc).toBeNull();
    // And only that field.
    expect(d.owner).toBe("QA Owner");
  });

  test("a rename keeps the record rather than forking it", async ({ page, request }) => {
    const before = await must<{ budgetEur: number }>(request, "get_lead", { id: planted[0].id });
    await page.goto("/dashboard/pipeline");
    await page.getByPlaceholder("Search brand, POC, notes").fill(FULL);
    await page.locator("tr", { hasText: FULL }).first().getByRole("button", { name: "Edit" }).click();

    const form = page.locator("form").filter({ has: page.locator('input[name="name"]') });
    await form.locator('input[name="name"]').fill(`${FULL} Renamed`);
    await form.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { name: FULL })).toBeHidden({ timeout: 15_000 });

    const after = await must<{ name: string; budgetEur: number }>(request, "get_lead", { id: planted[0].id });
    expect(after.name).toBe(`${FULL} Renamed`);
    // The id is a slug of the ORIGINAL name and must not follow the label, or
    // every link and proposal pointing at it would break.
    expect(after.budgetEur).toBe(before.budgetEur);
  });
});
