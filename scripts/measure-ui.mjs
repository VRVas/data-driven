import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  origin: { type: "string" }, output: { type: "string", default: ".data/ui-audit/report.json" },
  credentials: { type: "string" }, iterations: { type: "string", default: "1" },
  routes: { type: "string", default: "/,/login,/dashboard,/dashboard/pipeline,/dashboard/scoring,/dashboard/copilot" },
} });
const origin = new URL(values.origin ?? "http://127.0.0.1:3300");
if (origin.username || origin.password || (origin.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(origin.hostname))) throw new Error("Use HTTPS or a loopback test server.");
const iterations = Number(values.iterations);
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 5) throw new Error("Iterations must be between 1 and 5.");
const routes = values.routes.split(",");
if (routes.some(route => !route.startsWith("/") || route.startsWith("//"))) throw new Error("Routes must be local paths.");
if (!values.credentials && routes.some(route => route.startsWith("/dashboard"))) throw new Error("Authenticated routes require a private credentials file.");
mkdirSync(dirname(values.output), { recursive: true });
mkdirSync(".data", { recursive: true });
const lockPath = ".data/ui-audit.lock";
let lock;
try { lock = openSync(lockPath, "wx", 0o600); }
catch { throw new Error("Another UI audit owns .data/ui-audit.lock. Run measurements serially; remove a stale lock only after confirming its process exited."); }
writeFileSync(lock, String(process.pid));
process.once("exit", () => { closeSync(lock); unlinkSync(lockPath); });
const browser = await chromium.launch();
const report = { origin: origin.origin, measuredAt: new Date().toISOString(), environment: "production browser lab; not field INP", samples: [] };
try {
  let storageState;
  if (values.credentials) {
    const [email, password] = readFileSync(values.credentials, "utf8").trim().split(/\r?\n/);
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(new URL("/login", origin).href, { waitUntil: "domcontentloaded" });
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/dashboard", { timeout: 60000 });
    storageState = await context.storageState();
    await context.close();
  }
  for (const device of [
    { name: "desktop", viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, cpuRate: 1 },
    { name: "mobile", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, cpuRate: 4 },
  ]) {
    for (const route of routes) {
      for (let iteration = 0; iteration < iterations; iteration++) {
        const context = await browser.newContext({ viewport: device.viewport, isMobile: device.isMobile, hasTouch: device.hasTouch, reducedMotion: "no-preference", storageState });
        await context.addInitScript(() => {
          localStorage.setItem("oovie.tour.v1.done", "1");
          const state = window.__uiAudit = { lcp: 0, cls: 0, longTasks: [], interactions: [], particleMutations: 0 };
          for (const [type, consume] of [
            ["largest-contentful-paint", entry => { state.lcp = entry.startTime; }],
            ["layout-shift", entry => { if (!entry.hadRecentInput) state.cls += entry.value; }],
            ["longtask", entry => state.longTasks.push(entry.duration)],
            ["event", entry => { if (entry.interactionId) state.interactions.push(entry.duration); }],
          ]) {
            try { new PerformanceObserver(list => list.getEntries().forEach(consume)).observe({ type, buffered: true, durationThreshold: 16 }); } catch {}
          }
        });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        const session = await context.newCDPSession(page);
        await session.send("Performance.enable");
        await session.send("Network.enable");
        await session.send("Network.setCacheDisabled", { cacheDisabled: true });
        await session.send("Emulation.setCPUThrottlingRate", { rate: device.cpuRate });
        const response = await page.goto(new URL(route, origin).href, { waitUntil: "load", timeout: 60000 });
        if (!response?.ok() || new URL(page.url()).pathname !== route) throw new Error(`Unexpected response for ${route}: ${response?.status()}`);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(2500);
        const navigation = await page.evaluate(() => {
          const nav = performance.getEntriesByType("navigation")[0];
          const resources = performance.getEntriesByType("resource");
          return {
            ttfbMs: nav.responseStart, fcpMs: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0,
            lcpMs: window.__uiAudit.lcp, cls: window.__uiAudit.cls,
            jsBytes: resources.filter(entry => entry.initiatorType === "script").reduce((sum, entry) => sum + entry.encodedBodySize, 0),
            longTasksMs: window.__uiAudit.longTasks.reduce((sum, duration) => sum + duration, 0),
            blockingMs: window.__uiAudit.longTasks.reduce((sum, duration) => sum + Math.max(0, duration - 50), 0),
            documentOverflow: document.documentElement.scrollWidth - innerWidth,
            domNodes: document.querySelectorAll("*").length,
          };
        });
        const metrics = async () => Object.fromEntries((await session.send("Performance.getMetrics")).metrics.map(metric => [metric.name, metric.value]));
        await page.evaluate(() => {
          window.__particleObserver = new MutationObserver(entries => { window.__uiAudit.particleMutations += entries.length; });
          document.querySelectorAll(".particle").forEach(element => window.__particleObserver.observe(element, { attributes: true, attributeFilter: ["style"] }));
        });
        const before = await metrics();
        await page.waitForTimeout(2000);
        const after = await metrics();
        const idle = await page.evaluate(() => {
          window.__particleObserver.disconnect();
          return { particleStyleMutations: window.__uiAudit.particleMutations };
        });
        idle.scriptMs = (after.ScriptDuration - before.ScriptDuration) * 1000;
        idle.taskMs = (after.TaskDuration - before.TaskDuration) * 1000;
        idle.layoutMs = (after.LayoutDuration - before.LayoutDuration) * 1000;
        const frames = await page.evaluate(async () => {
          const samples = [];
          let previous = performance.now();
          const start = previous;
          await new Promise(resolve => {
            const frame = timestamp => { samples.push(timestamp - previous); previous = timestamp; if (timestamp - start < 1500) requestAnimationFrame(frame); else resolve(); };
            requestAnimationFrame(frame);
            window.scrollTo({ top: Math.min(document.body.scrollHeight - innerHeight, 900), behavior: "smooth" });
          });
          const sorted = samples.filter(value => value >= 0).sort((left, right) => left - right);
          return { count: sorted.length, over33ms: sorted.filter(value => value > 33.4).length, p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0 };
        });
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
        await page.waitForTimeout(500);
        const accessibility = iteration === 0 ? await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze() : null;
        const interactions = {};
        if (route === "/dashboard/pipeline") {
          const search = page.locator('input[placeholder*="Search"]').first();
          const started = performance.now();
          await search.fill("zz-ui-audit-no-match");
          await page.getByText("No leads match your filters.", { exact: true }).waitFor();
          interactions.searchMs = performance.now() - started;
          await search.fill("");
          interactions.keyboardSort = await page.locator("thead th").first().evaluate(element => !!element.querySelector("button") || element.tabIndex >= 0);
          await page.keyboard.press("Control+k");
          await page.getByRole("dialog", { name: "Command palette" }).waitFor();
          const palette = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
          interactions.paletteViolations = palette.violations.map(violation => ({ id: violation.id, impact: violation.impact, count: violation.nodes.length }));
          await page.keyboard.press("Escape");
        }
        const screenshot = join(dirname(values.output), `${device.name}-${route.replaceAll("/", "_") || "root"}-${iteration}.png`);
        await page.screenshot({ path: screenshot, fullPage: false });
        chmodSync(screenshot, 0o600);
        const eventTiming = await page.evaluate(() => Math.max(0, ...window.__uiAudit.interactions));
        const sample = { device: device.name, route, iteration, cpuRate: device.cpuRate, ...navigation, idle, frames, interactions, maxEventDurationMs: eventTiming, errors,
          accessibility: accessibility?.violations.map(violation => ({ id: violation.id, impact: violation.impact, count: violation.nodes.length, targets: violation.nodes.slice(0, 5).map(node => node.target) })) ?? null };
        report.samples.push(sample);
        writeFileSync(values.output, JSON.stringify(report, null, 2), { mode: 0o600 });
        console.log(JSON.stringify({ device: device.name, route, lcpMs: Math.round(sample.lcpMs), jsKB: Math.round(sample.jsBytes / 1024), idleScriptMs: Math.round(idle.scriptMs), violations: accessibility?.violations.length, errors: errors.length }));
        await context.close();
      }
    }
  }
} finally { await browser.close(); }