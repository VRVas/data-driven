import { externalPermission } from "@/lib/copilot/external/auth";
import { integrationFailure } from "@/lib/copilot/external/http";
import { consumeQuota, getTask, observeTask, taskView } from "@/lib/copilot/external/tasks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const caller = await externalPermission("copilot:use", request, "api");
    await consumeQuota(caller);
    const { id } = await context.params;
    await getTask(caller, id);
    const controller = new AbortController();
    const signal = AbortSignal.any([request.signal, controller.signal]);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(output) {
        try {
          for await (const task of observeTask(caller, id, signal)) output.enqueue(encoder.encode(`event: task\ndata: ${JSON.stringify(taskView(task))}\n\n`));
        } catch {
          if (!signal.aborted) output.enqueue(encoder.encode('event: error\ndata: {"code":"stream_interrupted","message":"Reconnect or retrieve the task status."}\n\n'));
        } finally { if (!controller.signal.aborted) output.close(); }
      },
      cancel() { controller.abort(); },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" } });
  } catch (error) { return integrationFailure(error); }
}