import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { SendMessageResponse, TaskState } from "@a2a-js/sdk";

export async function verifyCopilotIntegration({ baseUrl, token, fetchImpl = fetch }) {
  const base = new URL(baseUrl);
  if (base.username || base.password || (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)))) {
    throw new Error("Use HTTPS, or HTTP on loopback for local verification.");
  }
  if (!token || /\s/.test(token)) throw new Error("Set COPILOT_INTEGRATION_TOKEN to a registered access token.");
  const send = async (path, body, extraHeaders = {}, authenticated = true) => {
    const response = await fetchImpl(new URL(path, base.origin), {
      method: body === undefined ? "GET" : "POST",
      headers: { ...(authenticated ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }), ...extraHeaders },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error", signal: AbortSignal.timeout(180000),
    });
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}. Check server-side configuration and task status before retrying.`);
    return response;
  };
  const capabilities = await (await send("/api/copilot/v1/capabilities")).json();
  if (capabilities.apiVersion !== "1" || !capabilities.formats?.includes("json")) throw new Error("The server does not advertise the expected v1 JSON contract.");
  const contract = await (await send("/api/copilot/v1/openapi")).json();
  if (contract.openapi !== "3.1.0") throw new Error("The expected OpenAPI contract is unavailable.");
  const submitted = await (await send("/api/copilot/v1/messages", { message: "Summarise the pipeline. Do not propose or perform any changes.", format: "json" }, { "idempotency-key": randomUUID() })).json();
  if (typeof submitted.id !== "string" || !/^tsk-[a-f0-9]{40}$/.test(submitted.id)) throw new Error("The server returned an invalid task identifier.");
  const events = await send(`/api/copilot/v1/tasks/${submitted.id}/events`);
  if (!events.headers.get("content-type")?.includes("text/event-stream")) throw new Error("Task events were not returned as SSE.");
  await events.text();
  const task = await (await send(`/api/copilot/v1/tasks/${submitted.id}`)).json();
  if (task.state !== "completed" || task.actions?.length) throw new Error("The read-only REST probe did not complete without proposed actions. Inspect the task before retrying.");
  const card = await (await send("/.well-known/agent-card.json", undefined, {}, false)).json();
  if (!card.supportedInterfaces?.some((entry) => entry.protocolBinding === "JSONRPC" && entry.protocolVersion === "1.0" && entry.url === `${base.origin}/api/a2a`)) {
    throw new Error("The agent card does not advertise the expected same-origin A2A 1.0 endpoint.");
  }
  const envelope = await (await send("/api/a2a", {
    jsonrpc: "2.0", id: randomUUID(), method: "SendMessage",
    params: { message: { messageId: randomUUID(), role: "ROLE_USER", parts: [{ text: "Summarise the pipeline. Do not propose or perform any changes." }] }, configuration: { acceptedOutputModes: ["application/json"] } },
  }, { "A2A-Version": "1.0" })).json();
  const decoded = SendMessageResponse.fromJSON(envelope.result ?? {});
  const a2aTask = decoded.payload?.$case === "task" ? decoded.payload.value : undefined;
  if (envelope.error || a2aTask?.status?.state !== TaskState.TASK_STATE_COMPLETED) throw new Error("The read-only A2A probe did not complete. Inspect the server task status.");
  return { rest: { state: task.state, artifacts: task.result?.artifacts?.length ?? 0 }, a2a: { state: TaskState[a2aTask.status.state], artifacts: a2aTask.artifacts.length }, openapi: contract.openapi };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.env.APP_URL) throw new Error("Set APP_URL to the integration server origin.");
    const result = await verifyCopilotIntegration({ baseUrl: process.env.APP_URL, token: process.env.COPILOT_INTEGRATION_TOKEN });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Integration verification failed.");
    process.exitCode = 1;
  }
}