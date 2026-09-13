import { test, expect } from "./fixtures";
import { STORAGE_STATE, SCOPED_STORAGE_STATE, SCOPED_USER, TEST_USER } from "./constants";
import { QA, must, tool, uproot, ymd, type Planted } from "./qa-helpers";

/**
 * Merging two client records into one.
 *
 * A company is not stored: it is projected from its deals, so re-pointing every
 * deal IS the merge and a company with nothing left stops existing. That makes
 * two things worth proving. The money has to survive the move intact, because
 * a rollup that double-counts or drops a won deal is a wrong lifetime value on
 * a client page. And a partial merge must be impossible - moving the deals the
 * caller can reach and silently skipping the rest would SPLIT the client
 * instead of merging it, which is worse than refusing.
 */

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const planted: Planted[] = [];
let survivorDeal: Planted;
let absorbedDeal: Planted;
let foreignDeal: Planted;
let survivorId: string;
let absorbedId: string;
let foreignCompanyId: string;

const companyOf = async (request: import("@playwright/test").APIRequestContext, leadId: string) =>
  (await must<{ company: { id: string; name: string } }>(request, "get_company", { id: leadId })).company;

test.describe("as an administrator", () => {
  test.use({ storageState: STORAGE_STATE });

  test("two records for what is really one client", async ({ request }) => {
    const make = async (label: string, valueEur: number, status: string, owner: string) => {
      const created = await must<{ id: string }>(request, "create_lead", {
        name: `${QA} ${label}`,
        industry: "Fashion",
        status,
        owner,
        valueEur,
      });
      const p = { id: created.id, name: `${QA} ${label}` };
      planted.push(p);
      await must(request, "update_lead", { id: p.id, lastContact: ymd(-4) });
      return p;
    };

    // The same client typed two ways, plus a third owned by somebody else.
    survivorDeal = await make("Zenith Group", 40_000, "Closed deal", TEST_USER.name);
    absorbedDeal = await make("Zenith Holdings", 25_000, "Shape proposal", TEST_USER.name);
    foreignDeal = await make("Vertex Partners", 90_000, "Shape proposal", SCOPED_USER.name);

    await must(request, "set_budget", { id: survivorDeal.id, valueEur: 40_000, confidence: "Confirmed" });

    survivorId = (await companyOf(request, survivorDeal.id)).id;
    absorbedId = (await companyOf(request, absorbedDeal.id)).id;
    foreignCompanyId = (await companyOf(request, foreignDeal.id)).id;
    expect(survivorId).not.toBe(absorbedId);
  });

  test("the suggester offers them, and changes nothing", async ({ request }) => {
    const d = await must<{ groups: { companies: { id: string; name: string }[] }[] }>(
      request,
      "duplicate_companies",
      {},
    );
    const pair = d.groups.find((g) => g.companies.some((c) => c.id === survivorId));
    expect(pair, "a shared root should have been suggested").toBeTruthy();
    expect(pair!.companies.map((c) => c.id)).toContain(absorbedId);

    // Suggesting must never move anything.
    expect((await companyOf(request, absorbedDeal.id)).id).toBe(absorbedId);
  });

  test("merging a company into itself is refused", async ({ request }) => {
    const r = await must<{ ok: boolean; error?: string }>(request, "merge_companies", {
      sourceId: survivorId,
      targetId: survivorId,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/different/i);
  });

  test("merging into something that does not exist is refused", async ({ request }) => {
    const r = await must<{ ok: boolean }>(request, "merge_companies", {
      sourceId: survivorId,
      targetId: "co-does-not-exist",
    });
    expect(r.ok).toBe(false);
    // And the source is untouched.
    expect((await companyOf(request, survivorDeal.id)).id).toBe(survivorId);
  });

  test("the merge moves every deal and the money survives it", async ({ request }) => {
    const before = await must<{ company: { lifetimeValueEur: number; openPipelineEur: number } }>(
      request,
      "get_company",
      { id: survivorId },
    );
    expect(before.company.lifetimeValueEur).toBe(40_000);

    const r = await must<{ ok: boolean; movedDealIds: string[] }>(request, "merge_companies", {
      sourceId: absorbedId,
      targetId: survivorId,
    });
    expect(r.ok).toBe(true);
    expect(r.movedDealIds).toContain(absorbedDeal.id);

    const after = await must<{
      company: { lifetimeValueEur: number; openPipelineEur: number; wonDealCount: number; openDealCount: number };
      deals: { id: string }[];
    }>(request, "get_company", { id: survivorId });

    expect(after.deals.map((d) => d.id)).toEqual(expect.arrayContaining([survivorDeal.id, absorbedDeal.id]));
    // Won stays won, open stays open. Nothing is counted twice and nothing is
    // quietly reclassified by the move.
    expect(after.company.wonDealCount).toBe(1);
    expect(after.company.openDealCount).toBe(1);
    expect(after.company.lifetimeValueEur).toBe(40_000);
    expect(after.company.openPipelineEur).toBe(25_000);
  });

  test("the absorbed company stops existing rather than lingering empty", async ({ request }) => {
    const list = await must<{ companies: { id: string }[] }>(request, "search_companies", { query: "Zenith", limit: 25 });
    expect(list.companies.map((c) => c.id)).not.toContain(absorbedId);
    expect(list.companies.map((c) => c.id)).toContain(survivorId);
  });

  test("both deals still open, and both point at the survivor", async ({ page }) => {
    for (const d of [survivorDeal, absorbedDeal]) {
      await page.goto(`/dashboard/pipeline/${d.id}`);
      await expect(page.locator("body")).toContainText(d.name);
    }
    // The client's whole book is on the lead page now.
    await page.goto(`/dashboard/pipeline/${survivorDeal.id}`);
    const body = await page.locator("body").innerText();
    expect(body).toContain(survivorDeal.name);
    expect(body).toContain(absorbedDeal.name);
  });

  test("a merge can be undone one deal at a time", async ({ request }) => {
    const r = await must<{ ok: boolean }>(request, "unlink_deal", { id: absorbedDeal.id });
    expect(r.ok).toBe(true);
    const after = await must<{ deals: { id: string }[] }>(request, "get_company", { id: survivorId });
    expect(after.deals.map((d) => d.id)).not.toContain(absorbedDeal.id);
  });
});

test.describe("as an own-only account", () => {
  test.use({ storageState: SCOPED_STORAGE_STATE });

  test("a merge that would move a deal it cannot reach is refused whole", async ({ request }) => {
    // The rule that matters. Moving what it can reach and skipping the rest
    // would split the client silently.
    const r = await tool(request, "merge_companies", { sourceId: survivorId, targetId: foreignCompanyId });
    const body = r.data as { ok?: boolean } | undefined;
    expect(r.ok === false || body?.ok === false).toBe(true);
  });

  test("and nothing moved", async ({ request }) => {
    const mine = await must<{ deals: { id: string }[] }>(request, "get_company", { id: foreignCompanyId });
    expect(mine.deals.map((d) => d.id)).toEqual([foreignDeal.id]);
  });
});

test.describe("cleanup", () => {
  test.use({ storageState: STORAGE_STATE });
  test("remove the planted leads", async ({ request }) => {
    await uproot(request, planted);
  });
});
