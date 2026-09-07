import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
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
  EMPTY_ASSIGNMENT,
  systemProfile,
  type Profile,
} from "@/lib/auth/profiles";
import { resolvePermissions, scopeFor, can, exceedsAuthority } from "@/lib/auth/effective";
import { authorizeRecord, scopeFilter, type Authorized } from "@/lib/auth/authorize";
import { ForbiddenError } from "@/lib/auth/errors";
import type { AuthzContext } from "@/lib/auth/resolve";
import type { Scope } from "@/lib/auth/catalogue";

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

// ---------------------------------------------------------------------------
// Record gates - the half of authorization that says "this row", not "a row"
// ---------------------------------------------------------------------------

const context = (over: Partial<AuthzContext> = {}): AuthzContext => ({
  user: { id: "u1", email: "u1@example.com", name: "U1", role: "member" },
  effective: resolvePermissions([], EMPTY_ASSIGNMENT),
  superuser: false,
  profileIds: [],
  teamIds: [],
  ...over,
});

const authorized = (scope: Exclude<Scope, "none">, over: Partial<AuthzContext> = {}): Authorized => ({
  ...context(over),
  scope,
});

describe("authorizeRecord", () => {
  it("lets an org-wide scope through regardless of owner", () => {
    expect(() => authorizeRecord(context(), "all", { ownerId: "someone-else" })).not.toThrow();
  });

  it("lets a superuser through even at a narrow scope", () => {
    expect(() => authorizeRecord(context({ superuser: true }), "own", { ownerId: "x" })).not.toThrow();
  });

  it("allows own records and refuses everyone else's", () => {
    expect(() => authorizeRecord(context(), "own", { ownerId: "u1" })).not.toThrow();
    expect(() => authorizeRecord(context(), "own", { ownerId: "u2" })).toThrow(ForbiddenError);
  });

  it("refuses a record with no owner at a narrow scope", () => {
    // An unowned record matches nobody, so "own" cannot cover it. Failing open
    // here would make every unassigned lead editable by everyone.
    expect(() => authorizeRecord(context(), "own", { ownerId: null })).toThrow(ForbiddenError);
    expect(() => authorizeRecord(context(), "own", {})).toThrow(ForbiddenError);
  });

  it("allows a team-mate's record only at team scope", () => {
    const inTeam = context({ teamIds: ["t1"] });
    expect(() => authorizeRecord(inTeam, "team", { ownerId: "u2", teamId: "t1" })).not.toThrow();
    expect(() => authorizeRecord(inTeam, "own", { ownerId: "u2", teamId: "t1" })).toThrow(ForbiddenError);
    expect(() => authorizeRecord(inTeam, "team", { ownerId: "u2", teamId: "t2" })).toThrow(ForbiddenError);
  });

  it("refuses everything at scope none", () => {
    expect(() => authorizeRecord(context(), "none", { ownerId: "u1" })).toThrow(ForbiddenError);
  });

  it("reads the scope the write permission resolved to", () => {
    // The point of the fix: an Authorized carries its own scope, so a caller
    // with lead:read all and lead:update own cannot write through the wider one.
    const narrow = authorized("own");
    expect(() => authorizeRecord(narrow, narrow.scope, { ownerId: "u2" })).toThrow(ForbiddenError);
    const wide = authorized("all");
    expect(() => authorizeRecord(wide, wide.scope, { ownerId: "u2" })).not.toThrow();
  });
});

describe("scopeFilter", () => {
  const rows = [
    { ownerId: "u1", teamId: "t1" },
    { ownerId: "u2", teamId: "t1" },
    { ownerId: "u3", teamId: "t2" },
    { ownerId: null, teamId: null },
  ];

  it("keeps everything at all, nothing at none", () => {
    expect(rows.filter(scopeFilter(context(), "all"))).toHaveLength(4);
    expect(rows.filter(scopeFilter(context(), "none"))).toHaveLength(0);
  });

  it("keeps only my rows at own, and my team's at team", () => {
    expect(rows.filter(scopeFilter(context(), "own"))).toEqual([{ ownerId: "u1", teamId: "t1" }]);
    expect(rows.filter(scopeFilter(context({ teamIds: ["t1"] }), "team"))).toHaveLength(2);
  });

  it("drops unowned rows rather than showing them to everyone", () => {
    expect(rows.filter(scopeFilter(context(), "own")).some((r) => r.ownerId === null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The legacy role claim is not a display source
// ---------------------------------------------------------------------------

describe("what the UI calls you", () => {
  it("never derives a label or a gate from the session's legacy role claim", () => {
    // The top bar said Member to people the Team panel called Administrator.
    // Both read honestly, from different places. Assigning a profile does write
    // the legacy role to the store, but the session token keeps whatever it was
    // issued with, so `session.user.role` stays stale until the user signs out
    // and back in. Anything user-visible resolves through the profiles instead.
    //
    // Store records are a different matter: `u.role` / `target.role` are the
    // documented fallback for accounts written before profiles existed, so this
    // only bans the session claim.
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(p)) files.push(p);
      }
    };
    walk(path.join(process.cwd(), "src/components"));
    walk(path.join(process.cwd(), "src/app"));

    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (/\b(session\??\.)?user\??\.role\b\s*===/.test(line)) {
          offenders.push(`${path.relative(process.cwd(), f)}:${i + 1}`);
        }
      });
    }
    expect(offenders, `read the profiles instead:\n${offenders.join("\n")}`).toEqual([]);
  });
});
