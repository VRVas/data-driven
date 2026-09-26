import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { parse } from "yaml";

const mocks = vi.hoisted(() => ({ read: vi.fn(), database: vi.fn() }));
vi.mock("@/lib/recovery/backend", () => ({ recoveryEnabled: () => process.env.DATA_RECOVERY_ENABLED === "true", baselineDatabase: () => "bd", controlDatabaseName: () => "bd-recovery", rawDatabase: mocks.database }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); vi.resetModules(); });

describe("deployment readiness", () => {
  it("keeps setup and maintenance reachable without publishing internal state", async () => {
    vi.stubEnv("DATA_RECOVERY_ENABLED", "true");
    vi.stubEnv("COSMOS_ENDPOINT", "https://fixture.documents.azure.com");
    mocks.read.mockResolvedValue({ resource: { id: "operations" } });
    mocks.database.mockReturnValue({ container: () => ({ read: mocks.read }) });
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    await GET();
    expect(mocks.database).toHaveBeenCalledWith("bd-recovery");
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(mocks.read).toHaveBeenCalledWith({ abortSignal: expect.any(AbortSignal) });
  });
  it("fails closed when recovery storage is unavailable", async () => {
    vi.stubEnv("DATA_RECOVERY_ENABLED", "true");
    vi.stubEnv("COSMOS_ENDPOINT", "https://fixture.documents.azure.com");
    mocks.database.mockReturnValue({ container: () => ({ read: mocks.read }) });
    mocks.read.mockRejectedValue(new Error("Sensitive connection details"));
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });
});

describe("infrastructure coverage", () => {
  it("grants recovery only the required management actions and scopes them to the Cosmos account", () => {
    const source = readFileSync("infra/resources.bicep", "utf8");
    const role = source.match(/resource recoveryManagementRole\b[\s\S]*?(?=\nresource )/)?.[0];
    expect(role).toBeDefined();
    const actions = [...role!.matchAll(/'(Microsoft\.DocumentDB\/[^']+)'/g)].map((match) => match[1]);
    expect(actions).toEqual([
      "Microsoft.DocumentDB/databaseAccounts/read",
      "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/read",
      "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/write",
      "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/read",
      "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/write",
      "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/storedProcedures/read",
      "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/triggers/read",
      "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/userDefinedFunctions/read",
    ]);
    const assignment = source.match(/resource recoveryManagementAssignment\b[\s\S]*?(?=\nresource )/)?.[0];
    expect(assignment).toContain("scope: cosmos");
    expect(assignment).toContain("principalId: recoveryIdentity.?properties.principalId");
    expect(assignment).toContain("roleDefinitionId: recoveryManagementRole.id");
  });

  it("wires every operator-controlled infrastructure input through the deployment workflow", () => {
    const workflow = parse(readFileSync(".github/workflows/azure-dev.yml", "utf8"));
    const parameters = JSON.parse(readFileSync("infra/main.parameters.json", "utf8")).parameters as Record<string, { value: string }>;
    const generated = new Set(["AZURE_PRINCIPAL_ID", "SERVICE_WEB_IMAGE_NAME"]);
    for (const parameter of Object.values(parameters)) {
      const variable = /^\$\{([A-Z0-9_]+)/.exec(parameter.value)?.[1];
      expect(variable).toBeTruthy();
      if (!generated.has(variable!)) expect(workflow.jobs.deploy.env, variable).toHaveProperty(variable!);
    }
    expect(workflow.jobs.deploy.steps.some((step: { uses?: string }) => step.uses === "azure/login@v2")).toBe(true);
    expect(workflow.jobs.deploy.steps.some((step: { run?: string }) => step.run?.includes("npm run deploy"))).toBe(true);
    expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
  });

  it("accounts for every runtime environment variable", () => {
    const source = readFileSync("infra/resources.bicep", "utf8");
    const declarations = new Set([...source.matchAll(/name: '([A-Z_0-9]+)'/g)].map((match) => match[1]));
    for (const variable of ["AUTH_SECRET", "AUTH_TRUST_HOST", "AZURE_CLIENT_ID", "APPLICATIONINSIGHTS_CONNECTION_STRING"]) expect(declarations.has(variable), variable).toBe(true);
    const exceptions: Record<string, string> = {
      NODE_ENV: "Set by the Node image and Next runtime", NEXT_RUNTIME: "Set by Next.js",
      APP_DATA_DIR: "Local test data only", TELEGRAM_TEST_API_ROOT: "Loopback-only Telegram test adapter",
      ACS_CONNECTION_STRING: "Legacy local fallback; Azure uses managed identity", COPILOT_API_KEY: "Legacy tool/model key; deliberately not deployed",
      SPEECH_API_KEY: "Local fallback; Azure uses managed identity", SPEECH_ENDPOINT: "Falls back to deployed AZURE_OPENAI_ENDPOINT",
      FOUNDRY_MEMORY_STORE_ID: "Unimplemented preview adapter; not advertised as a deployed feature",
      REMINDER_DISPATCH_KEY: "Optional external scheduler credential; deployment uses the warm in-process scheduler",
      BREAKGLASS_ADMIN_EMAIL: "Optional local override; Azure recovery uses its independent recovery key",
      COPILOT_MAX_COMPLETION_TOKENS: "Provider has a validated default token budget",
      REMINDER_LOOP_MINUTES: "Warm worker has a one-minute default",
    };
    const missing = new Set<string>();
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) { walk(file); continue; }
        if (!/\.[jt]sx?$/.test(file)) continue;
        const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
        const visit = (node: ts.Node) => {
          if (ts.isPropertyAccessExpression(node) && node.expression.getText(ast) === "process.env" && !declarations.has(node.name.text) && !exceptions[node.name.text]) missing.add(node.name.text);
          ts.forEachChild(node, visit);
        };
        visit(ast);
      }
    };
    walk("src");
    expect([...missing]).toEqual([]);
  });
});