import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AgentCard, SendMessageRequest, GetTaskRequest, TaskState } from "@a2a-js/sdk";
import { ClientFactory, JsonRpcTransportFactory } from "@a2a-js/sdk/client";
import { test, expect } from "./fixtures";
import { EXTERNAL_TOKENS, SCOPED_STORAGE_STATE, SCOPED_USER, STORAGE_STATE, TELEGRAM_FIXTURE, TEST_USER } from "./constants";
import { must, plant, uproot, type Planted } from "./qa-helpers";
import type { APIRequestContext } from "@playwright/test";
import type { CopilotTask } from "@/lib/copilot/external/contracts";

test.use({ storageState: STORAGE_STATE });
const authorization = (token = EXTERNAL_TOKENS.read) => ({ authorization: `Bearer ${token}` });

async function taskResult(request: APIRequestContext, id: string, token = EXTERNAL_TOKENS.read): Promise<CopilotTask> {
  let result: CopilotTask;
  await expect.poll(async () => {
    const response = await request.get(`/api/copilot/v1/tasks/${id}`, { headers: authorization(token) });
    expect(response.ok()).toBe(true);
    result = await response.json();
    return result.state;
  }, { timeout: 60000 }).toMatch(/completed|input-required|failed|rejected/);
  return result!;
}

test.describe("external copilot REST and A2A", () => {
  test("needs a bearer token even when a web session exists", async ({ request }) => {
    const response = await request.post("/api/copilot/v1/messages", { data: { message: "Pipeline" } });
    expect(response.status()).toBe(401);
  });

  test("renders MarkdownV2, returns artifacts, deduplicates and isolates tasks", async ({ request }) => {
    const key = randomUUID();
    const headers = { ...authorization(), "idempotency-key": key };
    const data = { message: "Summarise the pipeline", format: "telegram-markdownv2" };
    const created = await request.post("/api/copilot/v1/messages", { headers, data });
    expect(created.status()).toBe(202);
    const submitted = await created.json();
    const replay = await request.post("/api/copilot/v1/messages", { headers, data });
    expect((await replay.json()).id).toBe(submitted.id);
    expect((await request.post("/api/copilot/v1/messages", { headers, data: { message: "Different" } })).status()).toBe(409);
    expect((await request.get(`/api/copilot/v1/tasks/${submitted.id}`, { headers: authorization(EXTERNAL_TOKENS.other) })).status()).toBe(404);
    const result = await taskResult(request, submitted.id);
    expect(result.state).toBe("completed");
    expect(result.result?.messages.every((message) => message.parseMode === "MarkdownV2" && message.text.length <= 3500)).toBe(true);
    expect(result.result?.artifacts.length).toBeGreaterThan(0);
    const artifact = result.result!.artifacts[0];
    const download = await request.get(`/api/copilot/v1/tasks/${submitted.id}/artifacts/${artifact.id}`, { headers: authorization() });
    expect(download.ok()).toBe(true);
    expect(await download.text()).toBe(artifact.text);
    const stream = await request.get(`/api/copilot/v1/tasks/${submitted.id}/events`, { headers: authorization() });
    expect(await stream.text()).toContain("event: task");
  });

  test("executes a proposed write only after explicit approval and refuses replay", async ({ request }) => {
    const lead = await plant(request, { label: `External Approval ${Date.now()}`, status: "Qualify lead", valueEur: 12345 });
    try {
      const created = await request.post("/api/copilot/v1/messages", { headers: { ...authorization(EXTERNAL_TOKENS.write), "idempotency-key": randomUUID() }, data: { message: `Move ${lead.name} to Shape proposal` } });
      expect(created.status()).toBe(202);
      const task = await taskResult(request, (await created.json()).id, EXTERNAL_TOKENS.write);
      expect(task.state).toBe("input-required");
      const before = await must<{ status: string }>(request, "get_lead", { id: lead.id });
      expect(before.status).toBe("Qualify lead");
      const action = task.actions[0];
      const endpoint = `/api/copilot/v1/tasks/${task.id}/actions/${action.id}`;
      expect((await request.post(endpoint, { headers: authorization(), data: { decision: "approve" } })).status()).toBe(403);
      const approved = await request.post(endpoint, { headers: authorization(EXTERNAL_TOKENS.write), data: { decision: "approve" } });
      expect(approved.ok()).toBe(true);
      expect((await approved.json()).actions[0].state).toBe("succeeded");
      expect((await must<{ status: string }>(request, "get_lead", { id: lead.id })).status).toBe("Shape proposal");
      expect((await request.post(endpoint, { headers: authorization(EXTERNAL_TOKENS.write), data: { decision: "approve" } })).status()).toBe(409);
    } finally { await uproot(request, [lead]); }
  });

  test("the official A2A client discovers and invokes the deployed app routes", async ({ baseURL, request }) => {
    const rawCard = await request.get("/.well-known/agent-card.json");
    expect(rawCard.ok()).toBe(true);
    const card = AgentCard.fromJSON(await rawCard.json());
    expect(card.supportedInterfaces[0].url).toBe(`${baseURL}/api/a2a`);
    const authenticatedFetch: typeof fetch = (input, init) => fetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), ...authorization() } });
    const client = await new ClientFactory({ transports: [new JsonRpcTransportFactory({ fetchImpl: authenticatedFetch })] }).createFromAgentCard(card);
    const response = await client.sendMessage(SendMessageRequest.fromJSON({ message: { messageId: randomUUID(), role: "ROLE_USER", parts: [{ text: "Summarise the pipeline" }] } }));
    expect("status" in response && response.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    if (!("id" in response)) throw new Error("Expected an A2A task");
    const loaded = await client.getTask(GetTaskRequest.fromJSON({ id: response.id }));
    expect(loaded.artifacts.length).toBeGreaterThan(0);
    expect(loaded.artifacts[0].parts[0].content?.$case).toBe("data");
  });

  test("publishes a guarded OpenAPI contract and current capabilities", async ({ request }) => {
    const contract = await request.get("/api/copilot/v1/openapi", { headers: authorization() });
    expect(contract.ok()).toBe(true);
    const schema = await contract.json();
    expect(schema.openapi).toBe("3.1.0");
    expect(schema.paths["/api/copilot/v1/tasks/{id}/actions/{actionId}"].post).toBeTruthy();
    expect((await request.get("/api/copilot/v1/openapi")).status()).toBe(401);
  });

  test("the read-only operational verifier runs against the actual routes", async ({ baseURL }) => {
    test.setTimeout(120000);
    const { stdout } = await promisify(execFile)(process.execPath, ["scripts/verify-copilot-integration.mjs"], {
      env: { ...process.env, APP_URL: baseURL, COPILOT_INTEGRATION_TOKEN: EXTERNAL_TOKENS.read }, timeout: 110000,
    });
    const result = JSON.parse(stdout);
    expect(result.rest.state).toBe("completed");
    expect(result.a2a.state).toBe("TASK_STATE_COMPLETED");
  });
});

test.describe("Telegram through a local Bot API emulator", () => {
  let gateway: Server;
  const outgoing: { method: string; body: Record<string, unknown> }[] = [];
  let updateId = Date.now();
  test.beforeAll(async () => {
    gateway = createServer(async (request, response) => {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const method = request.url?.split("/").pop() ?? "";
      const body = request.headers["content-type"]?.includes("application/json") ? JSON.parse(raw) : {};
      outgoing.push({ method, body });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ok: true, result: method === "answerCallbackQuery" ? true : { message_id: outgoing.length, date: Math.floor(Date.now() / 1000), chat: { id: TELEGRAM_FIXTURE.userId, type: "private" }, text: body.text ?? "" } }));
    });
    await new Promise<void>((resolve) => gateway.listen(Number(process.env.PW_PORT ?? 3100) + 1, "127.0.0.1", resolve));
  });
  test.afterAll(async () => { gateway.closeAllConnections(); await new Promise<void>((resolve) => gateway.close(() => resolve())); });
  test.afterEach(async ({}, info) => {
    if (info.status === info.expectedStatus) return;
    const records = JSON.parse(await readFile(".data/copilot-integrations.json", "utf8")) as Record<string, unknown>[];
    const metadata = records.map((record) => ({ id: record.id, kind: record.kind, state: record.state, error: record.error, errorCode: record.errorCode, attempts: record.attempts, leaseUntil: record.leaseUntil }));
    await info.attach("integration-status", { body: JSON.stringify({ records: metadata, outgoing }, null, 2), contentType: "application/json" });
  });

  async function update(request: APIRequestContext, text: string) {
    const payload = { update_id: updateId++, message: { message_id: updateId, from: { id: TELEGRAM_FIXTURE.userId, is_bot: false, first_name: "Telegram Fixture" }, chat: { id: TELEGRAM_FIXTURE.userId, type: "private" }, text } };
    const response = await request.post("/api/channels/telegram/webhook", { headers: { "x-telegram-bot-api-secret-token": TELEGRAM_FIXTURE.secret }, data: payload });
    expect(response.ok()).toBe(true);
    return payload;
  }

  test("links after web confirmation, delivers artifacts, approves once, and revokes access", async ({ page, request }) => {
    test.setTimeout(180000);
    expect((await request.post("/api/channels/telegram/webhook", { data: { update_id: 1 } })).status()).toBe(401);
    await page.goto("/dashboard/copilot/integrations");
    await page.getByRole("button", { name: "Connect Telegram", exact: true }).click();
    const botLink = page.getByRole("link", { name: "Open Telegram" });
    await expect(botLink).toBeVisible();
    const token = new URL((await botLink.getAttribute("href"))!).searchParams.get("start")!;
    await update(request, `/start ${token}`);
    await expect.poll(() => outgoing.some((entry) => String(entry.body.text).includes("Connection requested")), { timeout: 30000 }).toBe(true);
    await page.getByRole("button", { name: "Check connection" }).click();
    await expect(page.getByRole("button", { name: "Confirm this account" })).toBeVisible();
    await page.getByRole("button", { name: "Confirm this account" }).click();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    const sent = await update(request, "Summarise the pipeline");
    await request.post("/api/channels/telegram/webhook", { headers: { "x-telegram-bot-api-secret-token": TELEGRAM_FIXTURE.secret }, data: sent });
    await expect.poll(() => outgoing.some((entry) => entry.body.parse_mode === "MarkdownV2" && /pipeline/i.test(String(entry.body.text))), { timeout: 60000 }).toBe(true);
    await expect.poll(() => outgoing.some((entry) => entry.method === "sendDocument"), { timeout: 30000 }).toBe(true);
    const lead = await plant(request, { label: `Telegram Approval ${Date.now()}`, status: "Qualify lead", valueEur: 23456 });
    try {
      const cutoff = outgoing.length;
      await update(request, `Move ${lead.name} to Shape proposal`);
      type Keyboard = { inline_keyboard: { text: string; callback_data: string }[][] };
      await expect.poll(() => outgoing.slice(cutoff).some((entry) => (entry.body.reply_markup as Keyboard | undefined)?.inline_keyboard?.length), { timeout: 60000 }).toBe(true);
      const proposal = outgoing.slice(cutoff).find((entry) => (entry.body.reply_markup as Keyboard | undefined)?.inline_keyboard?.length)!;
      const confirm = (proposal.body.reply_markup as Keyboard).inline_keyboard.flat().find((button) => button.text.startsWith("Confirm:"))!;
      expect(confirm.callback_data.length).toBeLessThanOrEqual(64);
      expect((await must<{ status: string }>(request, "get_lead", { id: lead.id })).status).toBe("Qualify lead");
      const decision = { update_id: updateId++, callback_query: {
        id: randomUUID(), from: { id: TELEGRAM_FIXTURE.userId, is_bot: false, first_name: "Telegram Fixture" },
        message: { message_id: 1234, chat: { id: TELEGRAM_FIXTURE.userId, type: "private" } }, data: confirm.callback_data,
      } };
      const headers = { "x-telegram-bot-api-secret-token": TELEGRAM_FIXTURE.secret };
      expect((await request.post("/api/channels/telegram/webhook", { headers, data: decision })).ok()).toBe(true);
      expect((await request.post("/api/channels/telegram/webhook", { headers, data: decision })).ok()).toBe(true);
      await expect.poll(async () => (await must<{ status: string }>(request, "get_lead", { id: lead.id })).status, { timeout: 30000 }).toBe("Shape proposal");
      await expect.poll(() => outgoing.slice(cutoff).some((entry) => String(entry.body.text).includes("succeeded")), { timeout: 30000 }).toBe(true);
      expect(outgoing.some((entry) => entry.method === "answerCallbackQuery")).toBe(true);
      const replayStart = outgoing.length;
      expect((await request.post("/api/channels/telegram/webhook", { headers, data: { ...decision, update_id: updateId++, callback_query: { ...decision.callback_query, id: randomUUID() } } })).ok()).toBe(true);
      await expect.poll(() => outgoing.slice(replayStart).some((entry) => String(entry.body.text).includes("already succeeded")), { timeout: 30000 }).toBe(true);
    } finally { await uproot(request, [lead]); }
    await page.screenshot({ path: "e2e-artifacts/screens/integrations-connected-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "e2e-artifacts/screens/integrations-connected-mobile.png", fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(page.getByText("Not connected", { exact: true })).toBeVisible();
    const cutoff = outgoing.length;
    await update(request, "Summarise the pipeline again");
    await expect.poll(() => outgoing.slice(cutoff).some((entry) => /link telegram|connect telegram/i.test(String(entry.body.text))), { timeout: 30000 }).toBe(true);
  });

  test("a relinked own-only account gets a fresh context and cannot see another owner's leads", async ({ browser, request }) => {
    test.setTimeout(120000);
    const context = await browser.newContext({ storageState: SCOPED_STORAGE_STATE });
    const page = await context.newPage();
    const planted: Planted[] = [];
    try {
      const own = await plant(request, { label: `Telegram Scope Mine ${Date.now()}`, owner: SCOPED_USER.name, valueEur: 21000 });
      planted.push(own);
      const hidden = await plant(request, { label: `Telegram Scope Hidden ${Date.now()}`, owner: TEST_USER.name, valueEur: 7000000 });
      planted.push(hidden);
      await page.goto("/dashboard/copilot/integrations");
      await page.getByRole("button", { name: "Connect Telegram", exact: true }).click();
      const botLink = page.getByRole("link", { name: "Open Telegram" });
      await expect(botLink).toBeVisible();
      const cutoff = outgoing.length;
      await update(request, `/start ${new URL((await botLink.getAttribute("href"))!).searchParams.get("start")}`);
      await expect.poll(() => outgoing.slice(cutoff).some((entry) => String(entry.body.text).includes("Connection requested")), { timeout: 30000 }).toBe(true);
      await page.getByRole("button", { name: "Check connection" }).click();
      await page.getByRole("button", { name: "Confirm this account" }).click();
      await expect(page.getByText("Connected", { exact: true })).toBeVisible();
      const answerStart = outgoing.length;
      await update(request, "Top 6 leads");
      await expect.poll(() => outgoing.slice(answerStart).some((entry) => entry.body.parse_mode === "MarkdownV2" && String(entry.body.text).includes(own.name)), { timeout: 60000 }).toBe(true);
      const rendered = JSON.stringify(outgoing.slice(answerStart));
      expect(rendered).not.toContain(hidden.name);
      expect(rendered).not.toContain("7000000");
      const records = JSON.parse(await readFile(".data/copilot-integrations.json", "utf8")) as CopilotTask[];
      const ownTask = records.find((record) => record.kind === "task" && record.identity.userId === SCOPED_USER.id && record.input.message === "Top 6 leads")!;
      expect(ownTask.state).toBe("completed");
      expect(JSON.stringify(ownTask.result)).toContain(own.name);
      expect(JSON.stringify(ownTask.result)).not.toContain(hidden.name);
      expect(records.some((record) => record.kind === "task" && record.identity.userId === "e2e-user" && record.contextId === ownTask.contextId)).toBe(false);
    } finally {
      if (await page.getByRole("button", { name: "Disconnect", exact: true }).isVisible()) await page.getByRole("button", { name: "Disconnect", exact: true }).click();
      await context.close();
      await uproot(request, planted);
    }
  });
});