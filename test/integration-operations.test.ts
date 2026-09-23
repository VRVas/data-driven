import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020";
import { marked } from "marked";
import { integrationOpenApi } from "@/lib/copilot/external/openapi";
import { MessageInputSchema } from "@/lib/copilot/external/contracts";
import { validateIntegrationEnvironment } from "../scripts/validate-integrations.mjs";
import { verifyCopilotIntegration } from "../scripts/verify-copilot-integration.mjs";

describe("integration deployment validation", () => {
  it("generates missing recovery credentials without treating azd error output as a secret", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "recovery-preprovision-"));
    const stateFile = resolve(directory, "state.json");
    const original = "existing-auth-secret-fixture-0000000000";
    writeFileSync(stateFile, JSON.stringify({ AUTH_SECRET: original }));
    writeFileSync(resolve(directory, "azd"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const file = process.env.FIXTURE_AZD_STATE;
const state = JSON.parse(fs.readFileSync(file, "utf8"));
if (args[1] === "get-value") {
  if (!(args[2] in state)) { console.log("ERROR: key not found in environment values"); process.exit(1); }
  console.log(state[args[2]]);
} else if (args[1] === "set") {
  state[args[2]] = args[3]; fs.writeFileSync(file, JSON.stringify(state));
} else process.exit(2);
`, { mode: 0o700 });
    try {
      const run = () => spawnSync("sh", [resolve("scripts/preprovision.sh")], { encoding: "utf8", env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, FIXTURE_AZD_STATE: stateFile } });
      const first = run();
      expect(first.status, first.stderr).toBe(0);
      const created = JSON.parse(readFileSync(stateFile, "utf8"));
      expect(created.AUTH_SECRET).toBe(original);
      expect(created.DATA_RECOVERY_KEY.length).toBeGreaterThanOrEqual(32);
      expect(first.stdout).not.toContain(created.DATA_RECOVERY_KEY);
      const second = run();
      expect(second.status, second.stderr).toBe(0);
      expect(JSON.parse(readFileSync(stateFile, "utf8"))).toEqual(created);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("keeps integrations opt-in and rejects incomplete channel setup", () => {
    expect(validateIntegrationEnvironment({})).toEqual([]);
    expect(validateIntegrationEnvironment({ ENABLE_TELEGRAM: "true" })).toHaveLength(4);
    expect(validateIntegrationEnvironment({ ENABLE_COPILOT_INTEGRATIONS: "true" })).toHaveLength(1);
  });

  it("accepts Key Vault references and requires both Entra settings", () => {
    const settings = { ENABLE_COPILOT_INTEGRATIONS: "true", COPILOT_CLIENTS_KEY_VAULT_URL: "https://fixture.vault.azure.net/secrets/clients", COPILOT_ENTRA_TENANT_ID: "fixture", COPILOT_ENTRA_AUDIENCE: "api://fixture" };
    expect(validateIntegrationEnvironment(settings)).toEqual([]);
    expect(validateIntegrationEnvironment({ ...settings, COPILOT_ENTRA_AUDIENCE: "" })).toHaveLength(1);
    expect(validateIntegrationEnvironment({ ...settings, COPILOT_CLIENTS_KEY_VAULT_URL: "https://attacker.invalid/secrets/clients" })).toHaveLength(1);
  });
});

describe("read-only integration verifier", () => {
  it("checks REST, SSE, discovery and A2A without exposing credentials or approving writes", async () => {
    const taskId = `tsk-${"a".repeat(40)}`;
    const fetchImpl = vi.fn(async (request: string | URL | Request, init: RequestInit = {}) => {
      const input = new URL(request instanceof Request ? request.url : request);
      expect(input.origin).toBe("http://127.0.0.1:3100");
      expect(init.redirect).toBe("error");
      const headers = new Headers(init.headers);
      expect(headers.has("cookie")).toBe(false);
      if (input.pathname === "/.well-known/agent-card.json") {
        expect(headers.has("authorization")).toBe(false);
        return Response.json({ supportedInterfaces: [{ url: "http://127.0.0.1:3100/api/a2a", protocolBinding: "JSONRPC", protocolVersion: "1.0" }] });
      }
      expect(headers.get("authorization")).toBe("Bearer fixture-token");
      if (input.pathname.endsWith("/capabilities")) return Response.json({ apiVersion: "1", formats: ["json"] });
      if (input.pathname.endsWith("/openapi")) return Response.json({ openapi: "3.1.0" });
      if (input.pathname.endsWith("/messages")) {
        expect(headers.get("idempotency-key")).toBeTruthy();
        return Response.json({ id: taskId }, { status: 202 });
      }
      if (input.pathname.endsWith("/events")) return new Response("event: task\ndata: {}\n\n", { headers: { "content-type": "text/event-stream" } });
      if (input.pathname.endsWith(taskId)) return Response.json({ state: "completed", actions: [], result: { artifacts: [] } });
      if (input.pathname === "/api/a2a") {
        const body = JSON.parse(String(init.body));
        expect(headers.get("A2A-Version")).toBe("1.0");
        expect(body.method).toBe("SendMessage");
        expect(body.params.message.role).toBe("ROLE_USER");
        expect(body.params.message.parts[0].text).toContain("Do not propose or perform any changes");
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { task: { status: { state: "TASK_STATE_COMPLETED" }, artifacts: [] } } });
      }
      throw new Error("Unexpected endpoint");
    });
    const result = await verifyCopilotIntegration({ baseUrl: "http://127.0.0.1:3100", token: "fixture-token", fetchImpl });
    expect(result.rest.state).toBe("completed");
    expect(result.a2a.state).toBe("TASK_STATE_COMPLETED");
    expect(JSON.stringify(result)).not.toContain("fixture-token");
    expect(fetchImpl).toHaveBeenCalledTimes(7);
  });

  it("refuses plaintext remote endpoints before sending a token", async () => {
    const fetchImpl = vi.fn();
    await expect(verifyCopilotIntegration({ baseUrl: "http://example.invalid", token: "secret", fetchImpl })).rejects.toThrow("HTTPS");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("published integration contracts", () => {
  it("keeps OpenAPI input validation aligned with the runtime schema", () => {
    const document = integrationOpenApi();
    const validate = new Ajv2020({ strict: false, validateFormats: false }).compile({ components: document.components, $ref: "#/components/schemas/MessageInput" });
    const examples = [{ message: "Fixture" }, { message: "Fixture", format: "telegram-markdownv2", reasoning: true },
      { message: "Fixture", taskId: "task-1" }, {}, { message: " " }, { message: "Fixture", format: "html" },
      { message: "Fixture", taskId: "" }, { message: "Fixture", userId: "another-user" }, { message: "Fixture", reasoning: "true" }];
    for (const example of examples) expect(validate(example), JSON.stringify(example)).toBe(MessageInputSchema.safeParse(example).success);
  });

  it("describes every v1 route and validates a public task and paginated response", () => {
    const document = integrationOpenApi();
    expect(Object.keys(document.paths)).toHaveLength(9);
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const validate = ajv.compile({ components: document.components, $ref: "#/components/schemas/TaskList" });
    const task = { apiVersion: "1", id: "fixture-task", contextId: "fe87522d-931d-4a78-9e2d-8fbbff10bc45", state: "completed",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), actions: [], tools: [],
      result: { format: "json", messages: [{ text: "Fixture" }], blocks: [], artifacts: [], warnings: [] } };
    expect(validate({ tasks: [task], nextOffset: null })).toBe(true);
    expect(validate({ tasks: [{ ...task, state: "invented" }], nextOffset: null })).toBe(false);
    expect(validate({ tasks: [task], nextOffset: "not-an-offset" })).toBe(false);
    expect(document.security).toEqual([{ bearer: [] }]);
  });

  it("keeps the guide's JSON, JavaScript, shell examples and local links usable", () => {
    const file = resolve("docs/COPILOT_INTEGRATION_GUIDE.md");
    const tokens = marked.lexer(readFileSync(file, "utf8"));
    let checked = 0;
    marked.walkTokens(tokens, (token) => {
      if (token.type === "link" && token.href.startsWith("../")) expect(existsSync(resolve(dirname(file), token.href)), token.href).toBe(true);
      if (token.type !== "code") return;
      if (token.lang === "json") { expect(() => JSON.parse(token.text)).not.toThrow(); checked++; }
      if (token.lang === "javascript" || token.lang === "bash") {
        const result = token.lang === "javascript" ? spawnSync(process.execPath, ["--check", "--input-type=module"], { input: token.text, encoding: "utf8" })
          : spawnSync("bash", ["-n"], { input: token.text, encoding: "utf8" });
        expect(result.status, result.stderr).toBe(0);
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(15);
  });
});