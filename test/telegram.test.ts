import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalIntegrationStore } from "@/lib/copilot/external/store";
import { claimLink, confirmLink, disconnectTelegram, linkStatus, startLink } from "@/lib/copilot/external/telegram-link";
import { deliverTelegram, enqueueTelegram, verifyTelegramWebhook, type TelegramApi } from "@/lib/copilot/external/telegram";
import { documentBase } from "@/lib/copilot/external/store";
import { GrammyError } from "grammy";

let directory: string;
let store: LocalIntegrationStore;
beforeEach(async () => {
  vi.stubEnv("COPILOT_EXTERNAL_ENABLED", "true"); vi.stubEnv("TELEGRAM_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123456:fixture-only"); vi.stubEnv("TELEGRAM_BOT_USERNAME", "fixture_copilot_bot");
  directory = await mkdtemp(path.join(os.tmpdir(), "copilot-telegram-"));
  store = new LocalIntegrationStore(path.join(directory, "store.json"));
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe("two-step Telegram account linking", () => {
  it("grants no access until the web user confirms the claimed identity", async () => {
    const link = await startLink("app-user", store);
    const token = new URL(link.url).searchParams.get("start")!;
    await claimLink(token, "101", "Fixture Person", store);
    expect((await linkStatus("app-user", store)).linked).toBeNull();
    expect((await linkStatus("app-user", store)).pending).toEqual({ id: "101", name: "Fixture Person" });
    await confirmLink("app-user", "101", store);
    expect((await linkStatus("app-user", store)).linked?.id).toBe("101");
  });

  it("rejects stolen, replayed, expired and mismatched link claims", async () => {
    const link = await startLink("app-user", store);
    const token = new URL(link.url).searchParams.get("start")!;
    await claimLink(token, "101", "Fixture", store);
    await expect(claimLink(token, "102", "Other", store)).rejects.toMatchObject({ status: 409 });
    await expect(confirmLink("other-app-user", "101", store)).rejects.toMatchObject({ status: 400 });
    await expect(confirmLink("app-user", "102", store)).rejects.toMatchObject({ status: 400 });
    await confirmLink("app-user", "101", store);
    await expect(claimLink(token, "101", "Fixture", store)).rejects.toMatchObject({ status: 400 });
    await expect(claimLink("invalid", "101", "Fixture", store)).rejects.toMatchObject({ status: 400 });
  });

  it("disconnects without exposing the old link as active", async () => {
    const link = await startLink("app-user", store);
    await claimLink(new URL(link.url).searchParams.get("start")!, "101", "Fixture", store);
    await confirmLink("app-user", "101", store);
    await disconnectTelegram("app-user", store);
    expect((await linkStatus("app-user", store)).linked).toBeNull();
  });
});

describe("Telegram webhook and durable delivery", () => {
  it("checks the webhook secret and rejects disabled deployments", () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "fixture-secret-with-at-least-32-characters");
    expect(() => verifyTelegramWebhook(new Request("https://example.invalid"))).toThrow();
    expect(() => verifyTelegramWebhook(new Request("https://example.invalid", { headers: { "x-telegram-bot-api-secret-token": "fixture-secret-with-at-least-32-characters" } }))).not.toThrow();
    vi.stubEnv("TELEGRAM_ENABLED", "false");
    expect(() => verifyTelegramWebhook(new Request("https://example.invalid"))).toThrow();
  });

  it("deduplicates updates and ignores group chats and bot senders", async () => {
    const update = { update_id: 101, message: { message_id: 1, chat: { id: 202, type: "private" }, from: { id: 202, is_bot: false, first_name: "Fixture" }, text: "Hello" } };
    expect(await enqueueTelegram(update, store)).toBe(true);
    expect(await enqueueTelegram(update, store)).toBe(false);
    expect(await enqueueTelegram({ ...update, update_id: 102, message: { ...update.message, chat: { id: -1, type: "group" } } }, store)).toBe(false);
    expect(await enqueueTelegram({ ...update, update_id: 103, message: { ...update.message, from: { ...update.message.from, is_bot: true } } }, store)).toBe(false);
  });

  it("does not resend a message after an ambiguous network failure", async () => {
    const row = (await store.create({ ...documentBase("telegram-outbox", "telegram:123456", "out:fixture"), kind: "telegram-outbox" as const, state: "queued" as const, chatId: "202", text: "Fixture", attempts: 0 }))!;
    const sendMessage = vi.fn().mockRejectedValue(new Error("Network interrupted"));
    await deliverTelegram(row, { sendMessage } as unknown as TelegramApi, store);
    const saved = await store.get<typeof row & { errorCode: string }>(row.partitionKey, row.id);
    expect(saved?.state).toBe("uncertain");
    expect(saved?.errorCode).toBe("network_outcome_unknown");
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("queues a known Telegram rate-limit rejection for a delayed retry", async () => {
    const row = (await store.create({ ...documentBase("telegram-outbox", "telegram:123456", "out:fixture"), kind: "telegram-outbox" as const, state: "queued" as const, chatId: "202", text: "Fixture", attempts: 0 }))!;
    const sendMessage = vi.fn().mockRejectedValue(new GrammyError("Limited", { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 10 } }, "sendMessage", {}));
    await deliverTelegram(row, { sendMessage } as unknown as TelegramApi, store);
    const saved = await store.get<typeof row & { availableAt: string }>(row.partitionKey, row.id);
    expect(saved?.state).toBe("queued");
    expect(Date.parse(saved!.availableAt)).toBeGreaterThan(Date.now());
  });
});