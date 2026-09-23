import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { withExecutionPolicy } from "@/lib/copilot/execution";
import { runTool } from "@/lib/copilot/dispatch";
import { runCopilotTurn } from "@/lib/copilot/runtime";

const mocks = vi.hoisted(() => ({ execute: vi.fn(async () => ({ changed: true })), can: vi.fn(async () => true),
  read: vi.fn(async () => ({ found: true, id: "fixture-lead", name: "Synthetic Integration Fixture", status: "Qualify lead", owner: "Test User", valueEur: 12345 })) }));
vi.mock("@/lib/auth/authorize", () => ({ can: mocks.can }));
vi.mock("@/lib/leads/visible", () => ({ getVisibleBrands: () => { throw new Error("Live integration probes cannot access stored CRM data."); } }));
vi.mock("@/lib/copilot/tools", () => {
  const definitions = [
    { name: "get_lead", description: "Read the synthetic fixture lead by ID.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } },
    { name: "advance_lead_stage", description: "Prepare a stage change. The execution policy returns a proposal requiring explicit confirmation.", parameters: {
      type: "object", properties: { id: { type: "string" }, to: { type: "string", enum: ["Qualify lead", "Shape proposal"] } }, required: ["id", "to"], additionalProperties: false,
    } },
  ];
  return {
    getToolByName: (name: string) => ({ name, permission: name === "get_lead" ? "lead:read" : "lead:update", write: !["read", "get_lead"].includes(name),
      parameters: definitions.find((definition) => definition.name === name)?.parameters ?? {}, execute: name === "get_lead" ? mocks.read : mocks.execute }),
    toolSchemas: () => definitions.map((definition) => ({ type: "function", function: definition })),
  };
});

const user = { id: "test-user", name: "Test User", email: "test@example.invalid", role: "member" as const };
afterEach(() => vi.clearAllMocks());

describe("shared copilot execution policy", () => {
  it("captures a proposed write without executing it", async () => {
    const propose = vi.fn();
    const result = await withExecutionPolicy({ writes: "propose", propose }, () => runTool("append_note", { body: "Fixture" }, user));
    expect(result.data).toMatchObject({ pending: true, requiresConfirmation: true });
    expect(propose).toHaveBeenCalledWith({ tool: "append_note", args: { body: "Fixture" } });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("rejects writes from read-only integrations", async () => {
    const result = await withExecutionPolicy({ writes: "deny" }, () => runTool("append_note", {}, user));
    expect(result.ok).toBe(false);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("executes approved writes only after checking both permissions", async () => {
    const result = await withExecutionPolicy({ writes: "execute" }, () => runTool("append_note", {}, user));
    expect(result.ok).toBe(true);
    expect(mocks.can).toHaveBeenCalledWith("lead:update");
    expect(mocks.can).toHaveBeenCalledWith("copilot:tool:write");
    expect(mocks.execute).toHaveBeenCalledOnce();
  });

  it("honors tool allowlists and cancellation before execution", async () => {
    expect((await withExecutionPolicy({ writes: "execute", allowedTools: [] }, () => runTool("append_note", {}, user))).ok).toBe(false);
    expect((await withExecutionPolicy({ writes: "execute", signal: AbortSignal.abort() }, () => runTool("append_note", {}, user))).ok).toBe(false);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

describe.skipIf(!process.env.COPILOT_LIVE_CHAT_ENDPOINT)("live Foundry runtime with synthetic tools only", () => {
  beforeAll(() => {
    const endpoint = new URL(process.env.COPILOT_LIVE_CHAT_ENDPOINT!);
    if (endpoint.protocol !== "https:" || !endpoint.hostname.endsWith(".services.ai.azure.com") || endpoint.username || endpoint.password) throw new Error("Use an authorized public-cloud Foundry HTTPS endpoint.");
    vi.stubEnv("COPILOT_CHAT_ENDPOINT", endpoint.href);
    vi.stubEnv("COPILOT_API_KEY", "");
    vi.stubEnv("COPILOT_MAX_COMPLETION_TOKENS", "4000");
    vi.stubEnv("COSMOS_ENDPOINT", "");
  });
  afterAll(() => vi.unstubAllEnvs());

  it("grounds a read-only answer in the synthetic tool result", async () => {
    const turn = await withExecutionPolicy({ writes: "deny", allowedTools: ["get_lead"] }, () => runCopilotTurn(
      "Read lead ID fixture-lead using get_lead and report its current stage and value. Do not propose changes.", user, { signal: AbortSignal.timeout(90000) }));
    expect(turn.provider).toBe("foundry");
    expect(turn.toolRuns.some((run) => run.tool === "get_lead" && run.ok)).toBe(true);
    expect(JSON.stringify(turn.blocks)).toContain("Qualify lead");
    expect(mocks.execute).not.toHaveBeenCalled();
  }, 100000);

  it("returns an actionable proposal without invoking a write executor", async () => {
    const turn = await withExecutionPolicy({ writes: "propose", allowedTools: ["get_lead", "advance_lead_stage"] }, () => runCopilotTurn(
      "Inspect synthetic lead ID fixture-lead, then prepare its move from Qualify lead to Shape proposal with advance_lead_stage. The tool only creates a proposal for later explicit confirmation; no change is approved yet.",
      user, { signal: AbortSignal.timeout(90000) }));
    expect(turn.provider).toBe("foundry");
    const proposals = turn.blocks.flatMap((block) => block.type === "actions" ? block.actions : []);
    expect(proposals).toEqual(expect.arrayContaining([expect.objectContaining({ tool: "advance_lead_stage", args: { id: "fixture-lead", to: "Shape proposal" } })]));
    expect(mocks.execute).not.toHaveBeenCalled();
  }, 100000);
});