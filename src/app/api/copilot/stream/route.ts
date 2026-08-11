import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { can } from "@/lib/auth/authorize";
import { streamTurn, wantsReasoning } from "@/lib/copilot/stream";
import { getConversationStore } from "@/lib/copilot/threads";
import { logAudit } from "@/lib/store/audit";
import type { Block } from "@/lib/copilot/blocks";

export const dynamic = "force-dynamic";

/** Server-Sent-Events stream of copilot blocks. Events: `block`, `tools`, `done`, `error`. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!(await can("copilot:use"))) return new Response("Forbidden", { status: 403 });

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

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const collected: Block[] = [];
      let provider = "local-preview";
      try {
        for await (const ev of streamTurn(message, user, { reasoning: deep })) {
          if (ev.type === "block") {
            collected.push(ev.block);
            send("block", ev.block);
          } else if (ev.type === "tools") {
            send("tools", ev.tools);
          } else {
            provider = ev.provider;
          }
        }

        // Persist the turn (short-term memory). Best-effort — never break the stream.
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
        send("error", { message: e instanceof Error ? e.message : "stream failed" });
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
