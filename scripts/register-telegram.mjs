import { Api, GrammyError } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const username = process.env.TELEGRAM_BOT_USERNAME;
const base = process.env.APP_URL;
if (!token || !secret || !/^[A-Za-z0-9_-]{32,256}$/.test(secret) || !base || !username) throw new Error("Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_BOT_USERNAME and APP_URL in the environment.");
const url = new URL("/api/channels/telegram/webhook", base);
if (url.protocol !== "https:") throw new Error("A public HTTPS APP_URL is required.");
try {
  const api = new Api(token);
  const me = await api.getMe();
  if (me.username !== username) throw new Error("The configured bot username does not match the token.");
  await api.setWebhook(url.href, { secret_token: secret, allowed_updates: ["message", "callback_query"], max_connections: 10, drop_pending_updates: false });
  await api.setMyCommands([{ command: "start", description: "Connect your account" }, { command: "help", description: "Available commands" }, { command: "new", description: "Start a new conversation" }, { command: "cancel", description: "Cancel the latest task" }]);
  const webhook = await api.getWebhookInfo();
  console.log(JSON.stringify({ bot: me.username, webhook: webhook.url, pendingUpdates: webhook.pending_update_count }));
} catch (error) {
  console.error(error instanceof GrammyError ? `Telegram refused setup (HTTP ${error.error_code}).` : "Telegram setup failed. Check credentials, bot username, network access and the HTTPS endpoint.");
  process.exitCode = 1;
}