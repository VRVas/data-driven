import { test, expect } from "./fixtures";
import { hash } from "bcryptjs";
import { readFile } from "node:fs/promises";
import dataset from "../src/data/dataset.json";
import { readPackage, writePackage, type BackupContainer } from "../src/lib/recovery/package";
import type { APIRequestContext, Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });
const key = "recovery-playwright-owner-key-0000000000000000";
const password = "RecoveryFixture123!";
const backupPassword = "BackupFixturePassword123!";
const adminEmail = "recovery-admin@example.invalid";
const guestEmail = "recovery-member@example.invalid";
let initialPackage: Buffer;
let replacementPackage: Buffer;
const headers = () => ({ origin: `http://localhost:${process.env.RECOVERY_PW_PORT ?? 3200}` });
const container = (name: string, partition: string, items: BackupContainer["items"]): BackupContainer => ({ definition: { id: name, partitionKey: { paths: [partition] } }, items, scripts: { storedProcedures: [], triggers: [], userDefinedFunctions: [] } });

test.beforeEach(async ({ page }, info) => {
  const debuggerSession = await page.context().newCDPSession(page);
  await debuggerSession.send("Debugger.enable");
  debuggerSession.on("Debugger.scriptFailedToParse", async (event) => {
    const source = await debuggerSession.send("Debugger.getScriptSource", { scriptId: event.scriptId }).catch(() => ({ scriptSource: "unavailable" }));
    await info.attach("failed-browser-script", { body: JSON.stringify({ url: event.url, source: source.scriptSource }), contentType: "application/json" });
  });
});

test.beforeAll(async () => {
  const passwordHash = await hash(password, 10);
  const users = container("users", "/email", [
    { id: "recovery-admin", name: "Recovery Admin", email: adminEmail, role: "admin", passwordHash, active: true, createdAt: new Date().toISOString() },
    { id: "recovery-member", name: "Recovery Member", email: guestEmail, role: "member", passwordHash, active: true, createdAt: new Date().toISOString() },
  ]);
  initialPackage = await writePackage("bd", [users,
    container("brands", "/id", [{ ...dataset.brands[0], id: "recovery-original", name: "Recovery Original", owner: "Recovery Admin", status: "Qualify lead" }]),
    container("notes", "/leadId", [{ id: "recovery-note", leadId: "recovery-original", body: "Original fixture note", authorId: "recovery-admin", authorName: "Recovery Admin", createdAt: new Date().toISOString() }])], new Date().toISOString());
  replacementPackage = await writePackage("bd", [users,
    container("brands", "/id", [{ ...dataset.brands[0], id: "recovery-replacement", name: "Recovery Replacement", owner: "Recovery Admin", status: "Shape proposal" }]),
    container("reminders", "/ownerId", [{ id: "recovery-old-reminder", ownerId: "recovery-admin", status: "scheduled" }])], new Date().toISOString());
});

async function unlock(page: Page, method: "key" | "account" = "key") {
  await page.goto("/recovery");
  await expect(page.getByRole("button", { name: "Unlock recovery", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: method === "key" ? "Environment recovery key" : "Administrator", exact: true }).click();
  if (method === "key") await page.getByLabel("Recovery key", { exact: true }).fill(key);
  else {
    await page.getByLabel("Administrator email", { exact: true }).fill(adminEmail);
    await page.getByLabel("Password", { exact: true }).fill(password);
  }
  await page.getByRole("button", { name: "Unlock recovery", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Import & restore" })).toBeVisible();
}
async function status(request: APIRequestContext) {
  const response = await request.get("/api/admin/recovery");
  expect(response.ok()).toBe(true);
  return response.json();
}
async function finish(request: APIRequestContext, id: string) {
  await expect.poll(async () => (await status(request)).jobs.find((job: { id: string }) => job.id === id)?.status, { timeout: 90000, intervals: [2000] }).toBe("completed");
}
async function signIn(page: Page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(adminEmail);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("empty deployments require recovery authorization and validate before initialization", async ({ page }) => {
  const request = page.request;
  expect((await request.get("/api/admin/recovery")).status()).toBe(401);
  await page.goto("/signup");
  await expect(page).toHaveURL(/\/recovery$/);
  await expect(page.getByText("Environment awaiting initialization")).toBeVisible();
  const invalid = await request.post("/api/admin/recovery/session", { headers: headers(), data: { recoveryKey: "wrong-recovery-key-000000000000000000" } });
  expect(invalid.status()).toBe(401);
  await unlock(page);
  const response = await request.post("/api/admin/recovery/upload", { headers: headers(), multipart: { file: { name: "invalid.tar.gz", mimeType: "application/gzip", buffer: Buffer.from("invalid") }, password: "", mode: "full" } });
  expect(response.status()).toBe(400);
  expect((await status(request)).state.mode).toBe("setup");
  await page.getByLabel("Backup package", { exact: true }).setInputFiles({ name: "initial.tar.gz", mimeType: "application/gzip", buffer: initialPackage });
  await page.getByRole("button", { name: "Upload & validate" }).click();
  await expect(page.getByRole("heading", { name: "Review before replacement" })).toBeVisible();
  const reviewed = await status(request);
  expect(reviewed.state.mode).toBe("setup");
  const job = reviewed.jobs[0];
  await page.screenshot({ path: "e2e-artifacts/screens/recovery-greenfield-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "e2e-artifacts/screens/recovery-greenfield-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByLabel("Replacement confirmation").fill("INITIALIZE");
  await page.getByRole("button", { name: "Initialize environment", exact: true }).click();
  await finish(request, job.id);
  const initialized = await status(request);
  expect(initialized.state.mode).toBe("ready");
  expect(initialized.state.outboundPaused).toBe(true);
  await signIn(page);
  await page.goto("/dashboard/pipeline/recovery-original");
  await expect(page.getByRole("heading", { name: "Recovery Original", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText("Original fixture note", { exact: true })).toBeVisible();
});

test("an admin downloads an encrypted complete package and a member cannot unlock recovery", async ({ page }) => {
  const request = page.request;
  await page.goto("/recovery");
  await page.locator('input[name="email"]').fill(guestEmail);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Unlock recovery", exact: true }).click();
  await expect(page.locator('form [role="alert"]')).toContainText("cannot manage database recovery");
  await page.locator('input[name="email"]').fill(adminEmail);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Unlock recovery", exact: true }).click();
  await page.getByRole("tab", { name: "Backups", exact: true }).click();
  await page.getByLabel("Backup password", { exact: true }).fill(backupPassword);
  await page.getByLabel("Repeat backup password").fill(backupPassword);
  await page.getByRole("button", { name: "Create backup", exact: true }).click();
  await expect.poll(async () => (await status(request)).jobs[0]?.type).toBe("backup");
  const job = (await status(request)).jobs[0];
  await finish(request, job.id);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download encrypted backup", exact: true }).click();
  const downloaded = await downloadEvent;
  const data = await readFile((await downloaded.path())!);
  await expect(readPackage(data, "wrong password")).rejects.toMatchObject({ code: "invalid_password" });
  const backup = await readPackage(data, backupPassword);
  expect(backup.containers.find((entry) => entry.definition.id === "brands")!.items[0].id).toBe("recovery-original");
  expect(backup.containers.find((entry) => entry.definition.id === "notes")!.items[0].id).toBe("recovery-note");
});

test("replacement invalidates old sessions, preserves rollback and cancels restored delivery", async ({ page }) => {
  const request = page.request;
  await signIn(page);
  await unlock(page);
  await page.getByLabel("Backup package", { exact: true }).setInputFiles({ name: "replacement.tar.gz", mimeType: "application/gzip", buffer: replacementPackage });
  await page.getByRole("button", { name: "Upload & validate" }).click();
  await expect(page.getByText(/Pending reminder cancelled/)).toBeVisible();
  const before = await status(request);
  const job = before.jobs[0];
  const crossOrigin = await request.post("/api/admin/recovery", { headers: { origin: "https://attacker.invalid" }, data: { action: "confirm", id: job.id, confirmation: job.confirmation } });
  expect(crossOrigin.status()).toBe(403);
  await page.getByLabel("Replacement confirmation").fill(job.confirmation);
  await page.getByRole("button", { name: "Replace active dataset", exact: true }).click();
  await finish(request, job.id);
  const after = await status(request);
  expect(after.state.previous).toBe(before.state.active);
  expect(after.jobs.find((entry: { id: string }) => entry.id === job.id).hasRollback).toBe(true);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page);
  await page.goto("/dashboard/pipeline/recovery-replacement");
  await expect(page.getByRole("heading", { name: "Recovery Replacement", exact: true, level: 1 })).toBeVisible();
  const reminder = await request.post("/api/copilot/tools/list_scheduled_reminders", { data: {} });
  if (reminder.ok()) expect(await reminder.text()).not.toContain('"status":"scheduled"');
});

test("rollback restores the previous dataset through the same reviewed workflow", async ({ page }) => {
  const request = page.request;
  await unlock(page);
  await page.getByRole("button", { name: "Review rollback", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review before replacement" })).toBeVisible();
  const job = (await status(request)).jobs[0];
  expect(job.type).toBe("rollback");
  await page.getByLabel("Replacement confirmation").fill(job.confirmation);
  await page.getByRole("button", { name: "Replace active dataset", exact: true }).click();
  await finish(request, job.id);
  await signIn(page);
  await page.goto("/dashboard/pipeline/recovery-original");
  await expect(page.getByRole("heading", { name: "Recovery Original", exact: true, level: 1 })).toBeVisible();
});

test("administrator recovery sessions require a new sign-in after activation", async ({ page }) => {
  const request = page.request;
  await unlock(page);
  const existing = await status(request);
  if (existing.state.mode === "setup") {
    const uploaded = await request.post("/api/admin/recovery/upload", { headers: headers(), multipart: {
      file: { name: "initial.tar.gz", mimeType: "application/gzip", buffer: initialPackage }, password: "", mode: "full",
    } });
    expect(uploaded.ok()).toBe(true);
    const initialization = await uploaded.json();
    expect((await request.post("/api/admin/recovery", { headers: headers(), data: { action: "confirm", id: initialization.id, confirmation: "INITIALIZE" } })).ok()).toBe(true);
    await finish(request, initialization.id);
  }
  expect((await request.delete("/api/admin/recovery/session", { headers: headers() })).ok()).toBe(true);
  await unlock(page, "account");
  await page.getByLabel("Backup package", { exact: true }).setInputFiles({ name: "replacement.tar.gz", mimeType: "application/gzip", buffer: replacementPackage });
  await page.getByRole("button", { name: "Upload & validate" }).click();
  await expect(page.getByRole("heading", { name: "Review before replacement" })).toBeVisible();
  const job = (await status(request)).jobs[0];
  await page.getByLabel("Replacement confirmation").fill(job.confirmation);
  await page.getByRole("button", { name: "Replace active dataset", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unlock recovery", exact: true })).toBeVisible({ timeout: 90000 });
  expect((await request.get("/api/admin/recovery")).status()).toBe(401);
  await page.getByLabel("Administrator email", { exact: true }).fill(adminEmail);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Unlock recovery", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Import & restore" })).toBeVisible();
  await finish(request, job.id);
  expect((await status(request)).state.outboundPaused).toBe(true);
});