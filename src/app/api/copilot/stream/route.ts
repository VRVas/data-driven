import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { streamTurn, wantsReasoning } from "@/lib/copilot/stream";
import { logAudit } from "@/lib/store/audit";

export const dynamic = "force-dynamic";

/** Server-Sent-Events stream of copilot blocks. Events: `block`, `tools`, `done`, `error`. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let message = "";
  let reasoning = false;
  try {
    const body = await req.json();
    message = String(body.message ?? "").trim().slice(0, 1000);
    reasoning = !!body.reasoning;
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
      try {
        for await (const ev of streamTurn(message, user, { reasoning: deep })) {
          if (ev.type === "block") send("block", ev.block);
          else if (ev.type === "tools") send("tools", ev.tools);
          else send("done", { provider: ev.provider });
        }
        await logAudit({
          actorId: user.id,
          actorName: user.name,
          action: "copilot.query",
          entity: "copilot",
          entityId: "-",
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
