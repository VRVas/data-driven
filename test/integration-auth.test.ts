import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { digest, externalPermission, ownerKey } from "@/lib/copilot/external/auth";
import { readBody } from "@/lib/copilot/external/http";

const mocks = vi.hoisted(() => ({ keys: undefined as JWTVerifyGetKey | undefined, user: vi.fn() }));
vi.mock("jose", async (original) => ({ ...await original<object>(), createRemoteJWKSet: () => mocks.keys }));
vi.mock("@/lib/store/users", () => ({ getUserStore: () => ({ findById: mocks.user }) }));
vi.mock("@/lib/store/profiles", () => ({ getProfileStore: () => ({ list: async () => [] }) }));

const token = "copilot.ext.fixture.AveryLongFixtureSecretThatIsNotReal";
const definition = { id: "fixture", name: "Fixture integration", tokenSha256: digest(token), permissions: { "copilot:use": "all", "lead:read": "own" }, scopes: ["copilot:read"] };
beforeEach(() => {
  vi.stubEnv("COPILOT_EXTERNAL_ENABLED", "true");
  vi.stubEnv("COPILOT_CLIENTS_JSON", JSON.stringify([definition]));
});
afterEach(() => vi.unstubAllEnvs());
const request = (authorization?: string) => new Request("https://example.invalid/api/copilot/v1/messages", { headers: authorization ? { authorization } : {} });

describe("external authentication", () => {
  it("uses a fixed caller identity and the configured narrow grants", async () => {
    const caller = await externalPermission("copilot:use", request(`Bearer ${token}`), "api");
    expect(caller.principal.user.id).toBe("integration:fixture");
    expect(caller.principal.effective.permissions["lead:read"]).toBe("own");
    expect(caller.principal.superuser).toBe(false);
    expect(caller.scopes).toEqual(["copilot:read"]);
  });

  it("fails closed for missing, malformed, incorrect, and revoked tokens", async () => {
    for (const header of [undefined, "Bearer", `Bearer ${token} extra`, `Bearer ${token}wrong`]) {
      await expect(externalPermission("copilot:use", request(header), "api")).rejects.toMatchObject({ status: 401 });
    }
    vi.stubEnv("COPILOT_CLIENTS_JSON", JSON.stringify([{ ...definition, enabled: false }]));
    await expect(externalPermission("copilot:use", request(`Bearer ${token}`), "api")).rejects.toMatchObject({ status: 401 });
  });

  it("cannot acquire write permissions from a read-only token", async () => {
    await expect(externalPermission("lead:update", request(`Bearer ${token}`), "api")).rejects.toMatchObject({ status: 403 });
  });

  it("keeps context ownership separate across integrations and channels", () => {
    expect(ownerKey({ kind: "client", clientId: "fixture", channel: "api" })).not.toBe(ownerKey({ kind: "client", clientId: "fixture", channel: "a2a" }));
    expect(ownerKey({ kind: "client", clientId: "fixture", channel: "api" })).not.toBe(ownerKey({ kind: "client", clientId: "other", channel: "api" }));
  });

  it("rejects oversized streamed bodies even without a content-length header", async () => {
    const payload = new Request("https://example.invalid", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "x".repeat(40000) }) });
    await expect(readBody(payload)).rejects.toMatchObject({ status: 413 });
  });
});

describe("Entra access-token verification", () => {
  const tenant = "e7f1696a-37dd-4876-accb-2facb8713917";
  const application = "ddf90b9a-9f48-4bf4-b054-6350524f2c3e";
  const person = "b38a41e0-2847-4e23-845a-37053856b7c2";
  const audience = "api://copilot-fixture";
  const issuer = `https://login.microsoftonline.com/${tenant}/v2.0`;
  let privateKey: CryptoKey;
  beforeAll(async () => {
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey;
    mocks.keys = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: "fixture-key", alg: "RS256", use: "sig" }] });
  });
  beforeEach(() => {
    vi.stubEnv("COPILOT_ENTRA_TENANT_ID", tenant);
    vi.stubEnv("COPILOT_ENTRA_AUDIENCE", audience);
    vi.stubEnv("COPILOT_CLIENTS_JSON", JSON.stringify([{ ...definition, entraAppId: application, delegatedUsers: { [person]: "fixture-human" },
      permissions: { "copilot:use": "all", "lead:read": "all" } }]));
    mocks.user.mockResolvedValue({ id: "fixture-human", email: "fixture@example.invalid", name: "Fixture Human", role: "member", active: true,
      assignment: { profileIds: [], grantOverrides: { "copilot:use": "all", "lead:read": "own", "lead:update": "own" } } });
  });
  const signed = (claims: Record<string, unknown> = {}, override: { issuer?: string; audience?: string; expiration?: number } = {}) => new SignJWT({ tid: tenant, azp: application, roles: ["Copilot.Invoke"], ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "fixture-key" }).setIssuer(override.issuer ?? issuer).setAudience(override.audience ?? audience)
    .setIssuedAt().setExpirationTime(override.expiration ?? Math.floor(Date.now() / 1000) + 300).sign(privateKey);

  it("verifies a service token without impersonating a human", async () => {
    const caller = await externalPermission("copilot:use", request(`Bearer ${await signed()}`), "api");
    expect(caller.principal.user.id).toBe("integration:fixture");
    expect(mocks.user).not.toHaveBeenCalled();
  });

  it("intersects delegated user permissions with client grants", async () => {
    const caller = await externalPermission("copilot:use", request(`Bearer ${await signed({ scp: "Copilot.Invoke", oid: person })}`), "api");
    expect(caller.principal.user.id).toBe("fixture-human");
    expect(caller.principal.effective.permissions["lead:read"]).toBe("own");
    expect(caller.principal.effective.permissions["lead:update"]).toBeUndefined();
    expect(caller.principal.superuser).toBe(false);
  });

  it("rejects incorrect issuer, audience, tenant, role, app and expiration", async () => {
    const tokens = [await signed({}, { issuer: "https://attacker.invalid" }), await signed({}, { audience: "api://other" }),
      await signed({ tid: "wrong-tenant" }), await signed({ roles: [] }), await signed({ azp: "wrong-app" }), await signed({}, { expiration: 1 })];
    for (const value of tokens) await expect(externalPermission("copilot:use", request(`Bearer ${value}`), "api")).rejects.toMatchObject({ status: 401 });
  });

  it("rejects an unmapped or disabled human even with a signed token", async () => {
    await expect(externalPermission("copilot:use", request(`Bearer ${await signed({ scp: "Copilot.Invoke", oid: "unmapped" })}`), "api")).rejects.toMatchObject({ status: 401 });
    mocks.user.mockResolvedValue({ id: "fixture-human", active: false });
    await expect(externalPermission("copilot:use", request(`Bearer ${await signed({ scp: "Copilot.Invoke", oid: person })}`), "api")).rejects.toMatchObject({ status: 403 });
  });
});