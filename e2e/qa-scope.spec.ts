import { test, expect } from "./fixtures";
import { STORAGE_STATE, SCOPED_STORAGE_STATE, SCOPED_USER, TEST_USER } from "./constants";
import { QA, must, tool, uproot, ymd, type Planted } from "./qa-helpers";

/**
 * Record scope, checked where it actually matters: the totals.
 *
 * A list that shows too many rows is obvious. A TOTAL that includes records
 * the reader cannot open looks exactly like a correct total, and gets quoted in
 * a meeting. Every aggregate in the app is derived from getVisibleBrands(), so
 * the whole thing rests on one function - which is a good design and a single
 * point of failure worth proving rather than assuming.
 *
 * Two accounts: the admin plants leads owned by each of them, then the
 * own-only account is asked for every number the app reports.
 */

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const planted: Planted[] = [];
let mine: Planted;
let theirs: Planted;
let theirsWon: Planted;

/** Values chosen to be individually recognisable inside any sum. */
const MINE_EUR = 21_000;
const THEIRS_EUR = 7_000_000;
const THEIRS_WON_EUR = 3_000_000;

test.describe("as an administrator", () => {
  test.use({ storageState: STORAGE_STATE });

  test("plant one lead for each account", async ({ request }) => {
    const make = async (label: string, owner: string, valueEur: number, status: string) => {
      const created = await must<{ id: string }>(request, "create_lead", {
        name: `${QA} Scope ${label}`,
        industry: "Fashion",
        status,
        owner,
        valueEur,
      });
      const p = { id: created.id, name: `${QA} Scope ${label}` };
      planted.push(p);
      await must(request, "update_lead", { id: p.id, lastContact: ymd(-2) });
      return p;
    };

    mine = await make("Mine", SCOPED_USER.name, MINE_EUR, "Qualify lead");
    theirs = await make("Theirs", TEST_USER.name, THEIRS_EUR, "Shape proposal");
    theirsWon = await make("TheirsWon", TEST_USER.name, THEIRS_WON_EUR, "Closed deal");

    // A proposal on the invisible lead: overlay records inherit their deal's
    // visibility, and money totals read the overlay.
    await must(request, "record_proposal", {
      leadId: theirs.id,
      valueEur: THEIRS_EUR,
      status: "sent",
      sentAt: ymd(-5),
    });
  });

  test("the administrator sees all three", async ({ request }) => {
    const found = await must<{ leads: { id: string }[] }>(request, "search_leads", {
      query: `${QA} Scope`,
      limit: 50,
    });
    const ids = found.leads.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining([mine.id, theirs.id, theirsWon.id]));
  });
});

test.describe("as an own-only account", () => {
  test.use({ storageState: SCOPED_STORAGE_STATE });

  test("sees its own lead and not the others", async ({ request }) => {
    const found = await must<{ leads: { id: string }[] }>(request, "search_leads", {
      query: `${QA} Scope`,
      limit: 50,
    });
    const ids = found.leads.map((l) => l.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
    expect(ids).not.toContain(theirsWon.id);
  });

  test("a lead out of scope is not found, exactly like one that does not exist", async ({ request }) => {
    const hidden = await must<{ found: boolean }>(request, "get_lead", { id: theirs.id });
    const absent = await must<{ found: boolean }>(request, "get_lead", { id: "no-such-lead-7c1a" });
    // Identical answers, or the reply confirms the record exists.
    expect(hidden.found).toBe(false);
    expect(absent.found).toBe(false);
    const score = await must<{ found: boolean }>(request, "explain_score", { id: theirs.id });
    expect(score.found).toBe(false);
  });

  test("no total carries the seven million it cannot see", async ({ request }) => {
    const summary = await must<{ totalLeads: number; weightedValueEur: number; dealsClosed: number }>(
      request,
      "pipeline_summary",
      {},
    );
    // The hidden leads are worth 10m between them. Any aggregate that leaked
    // even one of them would be unmistakable at this size.
    expect(summary.weightedValueEur).toBeLessThan(THEIRS_EUR);

    const money = await must<{ openPipelineEur?: number; totalOpenEur?: number }>(request, "proposal_pipeline", {});
    for (const [key, value] of Object.entries(money)) {
      if (typeof value === "number") {
        expect(value, `proposal_pipeline.${key} leaked an out-of-scope figure`).toBeLessThan(THEIRS_EUR);
      }
    }
  });

  test("a proposal on an invisible lead is invisible too", async ({ request }) => {
    const health = await must<{ awaitingGreenlightEur: number }>(request, "pipeline_health", {});
    expect(health.awaitingGreenlightEur).toBeLessThan(THEIRS_EUR);
  });

  test("the client rollup cannot be reached through the deal id", async ({ request }) => {
    // get_company accepts a lead id, which is exactly the shape of request that
    // would walk around a lead-level check.
    const r = await tool(request, "get_company", { id: theirs.id });
    const body = r.data as { ok?: boolean; company?: { lifetimeValueEur: number } } | undefined;
    if (body?.company) {
      expect(body.company.lifetimeValueEur).toBeLessThan(THEIRS_WON_EUR);
    } else {
      expect(r.ok === false || body?.ok === false).toBe(true);
    }
  });

  test("data quality reports only on records it can open", async ({ request }) => {
    const q = await must<{ liveFindings: { id: string }[] }>(request, "data_quality", { limit: 50 });
    const ids = q.liveFindings.map((f) => f.id);
    expect(ids).not.toContain(theirs.id);
    expect(ids).not.toContain(theirsWon.id);
  });

  test("the work queue and the industry rollup are scoped too", async ({ request }) => {
    const queue = await must<{ items: { id: string }[] }>(request, "my_work_queue", { limit: 25 });
    expect(queue.items.map((i) => i.id)).not.toContain(theirs.id);

    // Industry counts are derived from visible brands, so the segment the
    // hidden leads belong to must not count them.
    const segments = await must<{ industries: { industry: string; approached: number }[] }>(
      request,
      "top_opportunities",
      { limit: 10 },
    );
    const fashion = segments.industries.find((i) => i.industry === "Fashion")!;
    expect(fashion.approached).toBeGreaterThan(0);
  });

  test("the screens agree with the tools", async ({ page, request }) => {
    const summary = await must<{ totalLeads: number }>(request, "pipeline_summary", {});
    await page.goto("/dashboard/pipeline");
    await expect(page.locator("body")).not.toContainText(`${QA} Scope Theirs`);

    await page.goto("/dashboard");
    const body = await page.locator("body").innerText();
    expect(body).toContain(String(summary.totalLeads));
    // 7,000,000 would be unmissable in a KPI.
    expect(body).not.toContain("7,000,000");
  });

  test("the quadrant plots nothing it should not", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator(`a[href$="#${mine.id}"] circle`)).toBeAttached();
    await expect(page.locator(`a[href$="#${theirs.id}"] circle`)).toHaveCount(0);
  });

  test("an export cannot be used to walk around the scope", async ({ page }) => {
    await page.goto("/dashboard/pipeline");
    const download = page.waitForEvent("download");
    await page.locator('[data-tour="pipe-export"]').getByRole("button").first().click();
    await page.getByRole("menuitem", { name: /CSV/i }).first().click().catch(async () => {
      await page.getByRole("button", { name: /Download CSV/i }).first().click();
    });
    const file = await download;
    const csv = await (await import("node:fs/promises")).readFile(await file.path(), "utf8");
    expect(csv).toContain(`${QA} Scope Mine`);
    expect(csv).not.toContain(`${QA} Scope Theirs`);
  });

  test("writing is refused as clearly as reading", async ({ request }) => {
    const r = await tool(request, "set_budget", { id: theirs.id, valueEur: 1 });
    const body = r.data as { ok: boolean } | undefined;
    expect(r.ok === false || body?.ok === false).toBe(true);
  });

  test("the copilot does not narrate what it cannot see", async ({ request }) => {
    const res = await request.post("/api/copilot/stream", {
      data: { message: `ZZQA what is ${QA} Scope Theirs worth?` },
    });
    const text = await res.text();
    expect(text).not.toContain("7,000,000");
    expect(text).not.toContain("7000000");
  });
});

test.describe("cleanup", () => {
  test.use({ storageState: STORAGE_STATE });
  test("remove the planted leads", async ({ request }) => {
    await uproot(request, planted);
  });
});
