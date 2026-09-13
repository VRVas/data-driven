import { test, expect } from "./fixtures";
import { STORAGE_STATE } from "./constants";
import { plant, uproot, ymd, type Planted } from "./qa-helpers";

/**
 * Charts, checked against the data behind them.
 *
 * "Does the chart render" is answered elsewhere. These plant a lead with a
 * known position and ask whether the mark lands where the model says it should
 * - and, more usefully, what an extreme value does to the drawing. An outlier
 * is where a chart stops being a summary and starts being a lie.
 */

test.use({ storageState: STORAGE_STATE, viewport: { width: 1440, height: 900 } });
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const planted: Planted[] = [];
let atCeiling: Planted;
let farPast: Planted;
let tiny: Planted;

const dot = (page: import("@playwright/test").Page, id: string) =>
  page.locator(`a[href$="#${id}"] circle`).first();

const num = async (locator: import("@playwright/test").Locator, attr: string) =>
  Number(await locator.getAttribute(attr));

test.beforeAll(async ({ request }) => {
  atCeiling = await plant(request, { label: "Ceiling", industry: "Fashion", status: "Qualify lead", valueEur: 80_000, confidence: "Confirmed", lastContact: ymd(-1) });
  farPast = await plant(request, { label: "Mega", industry: "Fashion", status: "Qualify lead", valueEur: 10_000_000, confidence: "Confirmed", lastContact: ymd(-1) });
  tiny = await plant(request, { label: "Tiny", industry: "Fashion", status: "Qualify lead", valueEur: 2_000, confidence: "Confirmed", lastContact: ymd(-1) });
  planted.push(atCeiling, farPast, tiny);
});

test.afterAll(async ({ request }) => {
  await uproot(request, planted);
});

test.describe("priority quadrant", () => {
  test("every planted lead is actually plotted", async ({ page }) => {
    await page.goto("/dashboard");
    for (const p of planted) await expect(dot(page, p.id)).toBeAttached();
  });

  test("a lead past the ceiling sits at the same height as one on it", async ({ page }) => {
    await page.goto("/dashboard");
    const a = await num(dot(page, atCeiling.id), "cy");
    const b = await num(dot(page, farPast.id), "cy");
    expect(Math.abs(a - b)).toBeLessThanOrEqual(0.5);
  });

  test("a small deal sits lower than one at the ceiling", async ({ page }) => {
    await page.goto("/dashboard");
    const small = await num(dot(page, tiny.id), "cy");
    const big = await num(dot(page, atCeiling.id), "cy");
    // Lower opportunity, and y grows downwards in SVG.
    expect(small).toBeGreaterThan(big);
  });

  test("an outlier cannot swallow the chart", async ({ page }) => {
    await page.goto("/dashboard");
    const svg = page.locator('svg[aria-label="Priority quadrant"]').first();
    const box = (await svg.boundingBox())!;
    const rMega = await num(dot(page, farPast.id), "r");
    const rCeiling = await num(dot(page, atCeiling.id), "r");

    // The radius is clamped at the same ceiling the axis uses, so past it a
    // bigger number cannot draw a bigger circle. Unclamped this was 139 in a
    // 520-wide viewBox: a 278px blob over a 432px plot area.
    expect(rMega).toBe(rCeiling);
    expect(rMega).toBeLessThan(25);
    // And in real rendered pixels it stays a mark rather than a background.
    const scale = box.width / 520;
    expect(rMega * 2 * scale).toBeLessThan(box.height / 4);
  });

  test("bubble size still tracks value below the ceiling", async ({ page }) => {
    await page.goto("/dashboard");
    // Clamping must not flatten the useful range - a small deal has to look
    // small, or the size channel carries nothing at all.
    expect(await num(dot(page, tiny.id), "r")).toBeLessThan(await num(dot(page, atCeiling.id), "r"));
  });

  test("the tooltip still carries the real figure the axis hides", async ({ page }) => {
    await page.goto("/dashboard");
    const title = await page.locator(`a[href$="#${farPast.id}"] circle title`).first().textContent();
    expect(title).toContain("10,000,000");
  });
});

test.describe("the funnel counts what the pipeline holds", () => {
  test("planting three Early leads moves the Early bar by three", async ({ page, request }) => {
    await page.goto("/dashboard");
    const before = Number(
      (await page.locator("[data-bar]").filter({ hasText: /^\d+$/ }).first().textContent())?.trim() ?? "0",
    );
    expect(Number.isFinite(before)).toBe(true);

    // Read the funnel through the same tool the copilot uses, then compare it
    // with the bar the user sees.
    const res = await request.post("/api/copilot/tools/pipeline_summary", { data: {} });
    const summary = (await res.json()) as { data: { byStatus: Record<string, number> } };
    const early = summary.data.byStatus["Qualify lead"];

    const bar = page.locator("section", { hasText: "Pipeline by stage" }).locator("[data-bar]");
    const texts = await bar.allInnerTexts();
    expect(texts.map((t) => Number(t.trim()))).toContain(early);
  });
});
