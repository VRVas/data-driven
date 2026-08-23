import { NextRequest } from "next/server";
import { apiPermission } from "@/lib/auth/api";
import { streamTurn, wantsReasoning } from "@/lib/copilot/stream";
import { getConversationStore } from "@/lib/copilot/threads";
import { toModelHistory, type ChatTurn } from "@/lib/copilot/history";
import { logAudit } from "@/lib/store/audit";
import type { Block } from "@/lib/copilot/blocks";

export const dynamic = "force-dynamic";

/** Server-Sent-Events stream of copilot blocks. Events: `block`, `tools`, `done`, `error`. */
export async function POST(req: NextRequest) {
  const gate = await apiPermission("copilot:use");
  if (gate instanceof Response) return gate;
  const user = gate.user;

  let message = "";
  let reasoning = false;
  let conversationId: string | null = null;
  try {
    const body = await req.json();
    message = String(body.message ?? "").trim().slice(0, 1000);
    reasoning = !!body.reasoning;
    conversationId = typeof body.conversationId === "string" ? body.conversationId : null;
  } catch {
    /* fall through to 400 */
  }
  if (!message) return new Response("Bad request", { status: 400 });
  const deep = reasoning || wantsReasoning(message);

  // Read the thread back before answering. It has always been WRITTEN here;
  // never reading it is what made every turn the model's first.
  let history: ChatTurn[] = [];
  if (conversationId) {
    try {
      const prior = await getConversationStore().get(conversationId, user.id);
      if (prior) history = toModelHistory(prior.messages, message);
    } catch {
      // A conversation we cannot load costs continuity, not the answer.
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const collected: Block[] = [];
      let provider = "local-preview";
      try {
        for await (const ev of streamTurn(message, user, { reasoning: deep, history })) {
          if (ev.type === "block") {
            collected.push(ev.block);
            send("block", ev.block);
          } else if (ev.type === "tools") {
            send("tools", ev.tools);
          } else {
            provider = ev.provider;
          }
        }

        // Persist the turn (short-term memory). Best-effort - never break the stream.
        let convId = conversationId;
        try {
          const store = getConversationStore();
          if (!convId) convId = (await store.create(user.id, message)).id;
          await store.appendTurn(convId, user.id, message, collected);
        } catch {
          /* persistence is best-effort */
        }

        send("done", { provider, conversationId: convId });
        await logAudit({
          actorId: user.id,
          actorName: user.name,
          action: "copilot.query",
          entity: "copilot",
          entityId: convId ?? "-",
          summary: `Asked copilot${deep ? " (deep)" : ""}: ${message.slice(0, 80)}`,
        });
      } catch (e) {
        // The thread id rides on the error too. Without it a transient 429
        // silently starts a new conversation, so recovering from a blip costs
        // the user every turn of context they had built up.
        send("error", {
          message: e instanceof Error ? e.message : "stream failed",
          conversationId,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
