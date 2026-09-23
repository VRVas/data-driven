import { enqueueTelegram, startTelegramWorker, verifyTelegramWebhook } from "@/lib/copilot/external/telegram";
import { integrationFailure, integrationResponse, readBody } from "@/lib/copilot/external/http";
import { startCopilotWorker } from "@/lib/copilot/external/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    verifyTelegramWebhook(request);
    await enqueueTelegram(await readBody(request));
    startCopilotWorker(); startTelegramWorker();
    return integrationResponse({ ok: true });
  } catch (error) { return integrationFailure(error); }
}