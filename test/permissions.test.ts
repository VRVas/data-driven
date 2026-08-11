import { describe, it, expect } from "vitest";
import {
  PERMISSIONS,
  PERMISSION_KEYS,
  allPermissions,
  isPermissionKey,
  maxScope,
  scopeAtLeast,
  type PermissionKey,
} from "@/lib/auth/catalogue";
import {
  SYSTEM_PROFILES,
  ADMIN_PROFILE_ID,
  SALES_REP_PROFILE_ID,
  READ_ONLY_PROFILE_ID,
  systemProfile,
  type Profile,
} from "@/lib/auth/profiles";
import { resolvePermissions, scopeFor, can, exceedsAuthority } from "@/lib/auth/effective";

const profile = (id: string, permissions: Profile["permissions"], superuser = false): Profile => ({
  id,
  name: id,
  description: "",
  permissions,
  superuser,
  system: false,
});

describe("catalogue", () => {
  it("has unique, well-formed keys", () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
    for (const p of PERMISSIONS) expect(p.key).toMatch(/^[a-z]+:[a-z:]+$/);
  });

  it("recognises only real permissions", () => {
    expect(isPermissionKey("lead:read")).toBe(true);
    expect(isPermissionKey("lead:obliterate")).toBe(false);
  });

  it("orders scopes weakest to strongest", () => {
    expect(maxScope("own", "all")).toBe("all");
    expect(maxScope("team", "own")).toBe("team");
    expect(scopeAtLeast("all", "own")).toBe(true);
    expect(scopeAtLeast("own", "all")).toBe(false);
    expect(scopeAtLeast("none", "own")).toBe(false);
  });
});

describe("resolvePermissions", () => {
  it("denies everything by default", () => {
    const e = resolvePermissions([], { profileIds: [] });
    expect(scopeFor(e, "lead:read")).toBe("none");
    expect(can(e, "lead:read")).toBe(false);
  });

  it("unions profiles and keeps the strongest scope", () => {
    const e = resolvePermissions(
      [profile("a", { "lead:read": "own" }), profile("b", { "lead:read": "all" })],
      { profileIds: ["a", "b"] },
    );
    expect(scopeFor(e, "lead:read")).toBe("all");
  });

  it("adds per-user grants on top of profiles", () => {
    const e = resolvePermissions([profile("a", { "lead:read": "own" })], {
      profileIds: ["a"],
      grantOverrides: { "lead:delete": "all" },
    });
    expect(can(e, "lead:delete")).toBe(true);
  });

  it("lets an explicit deny beat any grant", () => {
    const e = resolvePermissions([profile("a", { "outreach:send": "all" })], {
      profileIds: ["a"],
      denyOverrides: ["outreach:send"],
    });
    expect(can(e, "outreach:send")).toBe(false);
  });

  it("ignores unknown keys and none-scopes rather than trusting them", () => {
    const e = resolvePermissions(
      [profile("a", { "lead:read": "none", "lead:bogus": "all" } as never)],
      { profileIds: ["a"] },
    );
    expect(scopeFor(e, "lead:read")).toBe("none");
  });

  it("treats superuser as a short-circuit, not a wildcard string", () => {
    const e = resolvePermissions([profile("admin", {}, true)], { profileIds: ["admin"] });
    expect(e.superuser).toBe(true);
    for (const k of PERMISSION_KEYS) expect(can(e, k, "all")).toBe(true);
  });
});

describe("exceedsAuthority", () => {
  it("stops a grant beyond the actor's own", () => {
    const actor = resolvePermissions([profile("a", { "lead:read": "own" })], { profileIds: ["a"] });
    expect(exceedsAuthority(actor, { "lead:read": "all" })).toEqual(["lead:read"]);
    expect(exceedsAuthority(actor, { "lead:read": "own" })).toEqual([]);
    expect(exceedsAuthority(actor, { "outreach:send": "all" })).toEqual(["outreach:send"]);
  });

  it("lets a superuser grant anything", () => {
    const actor = resolvePermissions([profile("admin", {}, true)], { profileIds: ["admin"] });
    expect(exceedsAuthority(actor, allPermissions())).toEqual([]);
  });
});

describe("seeded profiles", () => {
  it("keeps the administrator a superuser and every profile a system one", () => {
    const admin = systemProfile(ADMIN_PROFILE_ID)!;
    expect(admin.superuser).toBe(true);
    for (const p of SYSTEM_PROFILES) expect(p.system).toBe(true);
  });

  it("reproduces today's member exactly for sales rep", () => {
    const rep = resolvePermissions([systemProfile(SALES_REP_PROFILE_ID)!], {
      profileIds: [SALES_REP_PROFILE_ID],
    });
    // Everything a member can do today.
    for (const k of [
      "lead:read", "lead:create", "lead:update", "lead:stage:advance",
      "agent:create", "agent:delete", "outreach:compose", "outreach:cancel",
      "reminder:update", "view:create", "copilot:use", "copilot:tool:write", "export:csv",
    ] as PermissionKey[]) {
      expect(can(rep, k, "all"), `${k} should be granted`).toBe(true);
    }
    // And nothing that was admin-only.
    for (const k of ["lead:delete", "outreach:send", "profile:assign", "user:create", "audit:read"] as PermissionKey[]) {
      expect(can(rep, k), `${k} must stay admin-only`).toBe(false);
    }
  });

  it("gives read-only no way to change anything", () => {
    const ro = resolvePermissions([systemProfile(READ_ONLY_PROFILE_ID)!], {
      profileIds: [READ_ONLY_PROFILE_ID],
    });
    for (const k of PERMISSION_KEYS) {
      if (k.endsWith(":read")) continue;
      expect(can(ro, k), `${k} must not be granted`).toBe(false);
    }
    expect(can(ro, "lead:read", "all")).toBe(true);
  });
});
