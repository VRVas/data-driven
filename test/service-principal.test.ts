import { describe, it, expect } from "vitest";
import { apiKeyMatches } from "@/lib/auth/api";
import { copilotServicePrincipal } from "@/lib/auth/service";
import { runAsPrincipal, currentPrincipal } from "@/lib/auth/principal";
import { can, scopeFor } from "@/lib/auth/effective";
import { PERMISSION_KEYS } from "@/lib/auth/catalogue";

const service = copilotServicePrincipal();

describe("the copilot service identity", () => {
  it("can read the pipeline", () => {
    for (const key of ["lead:read", "proposal:read", "reminder:read", "scoring:read"] as const) {
      expect(can(service.effective, key), `service should hold ${key}`).toBe(true);
    }
  });

  it("cannot change anything, spend anything or reach outside", () => {
    // A shared key carries no accountability, so nothing it can do should ever
    // need to be explained afterwards.
    const forbidden = [
      "lead:create", "lead:update", "lead:delete", "lead:stage:advance",
      "outreach:compose", "outreach:approve", "outreach:send",
      "proposal:manage", "user:update", "profile:update",
      "export:csv", "export:excel", "export:pdf",
      "copilot:tool:write", "copilot:websearch", "copilot:documents",
      "audit:read", "user:read",
    ] as const;
    for (const key of forbidden) {
      expect(can(service.effective, key), `service must not hold ${key}`).toBe(false);
    }
  });

  it("is not a superuser and holds nothing outside the read set", () => {
    expect(service.superuser).toBe(false);
    const held = PERMISSION_KEYS.filter((k) => scopeFor(service.effective, k) !== "none");
    expect(held.sort()).toEqual(
      [
        "copilot:use",
        "industry:read",
        "lead:read",
        "outreach:read",
        "proposal:read",
        "quality:read",
        "reminder:read",
        "scoring:read",
        "tam:read",
      ].sort(),
    );
  });
});

describe("runAsPrincipal", () => {
  it("binds the principal for the duration of the call and no longer", async () => {
    expect(currentPrincipal()).toBeUndefined();
    const inside = await runAsPrincipal(service, async () => {
      await Promise.resolve();
      return currentPrincipal();
    });
    expect(inside).toBe(service);
    expect(currentPrincipal()).toBeUndefined();
  });

  it("does not leak into a concurrent call", async () => {
    const other = { ...service, user: { ...service.user, id: "other" } };
    const [a, b] = await Promise.all([
      runAsPrincipal(service, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return currentPrincipal()?.user.id;
      }),
      runAsPrincipal(other, async () => currentPrincipal()?.user.id),
    ]);
    expect(a).toBe("copilot-service");
    expect(b).toBe("other");
  });
});

describe("apiKeyMatches", () => {
  it("accepts the configured key and rejects everything else", () => {
    expect(apiKeyMatches("s3cret", "s3cret")).toBe(true);
    expect(apiKeyMatches("s3cre", "s3cret")).toBe(false);
    expect(apiKeyMatches("s3crett", "s3cret")).toBe(false);
    expect(apiKeyMatches("S3CRET", "s3cret")).toBe(false);
  });

  it("refuses when either side is missing, rather than matching empty against empty", () => {
    // An unset COPILOT_API_KEY must close the channel, not open it to a caller
    // who also sends nothing.
    expect(apiKeyMatches("", "")).toBe(false);
    expect(apiKeyMatches(null, "s3cret")).toBe(false);
    expect(apiKeyMatches(undefined, "s3cret")).toBe(false);
    expect(apiKeyMatches("s3cret", undefined)).toBe(false);
    expect(apiKeyMatches("s3cret", "")).toBe(false);
  });

  it("compares keys of differing length without throwing", () => {
    // timingSafeEqual rejects unequal buffers; hashing first is what makes a
    // wrong-length guess indistinguishable from a wrong-value one.
    expect(() => apiKeyMatches("a", "a-much-longer-key")).not.toThrow();
    expect(apiKeyMatches("a", "a-much-longer-key")).toBe(false);
  });
});
