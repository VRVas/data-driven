/**
 * Permission catalogue — the single source of truth for what can be granted.
 *
 * Deliberately NOT `server-only`: the admin profile editor and the capability
 * helpers render these labels in the browser. It contains no secrets, only the
 * vocabulary.
 *
 * Naming is `resource:action`. A permission is either:
 *  - SCOPED  — answers "over which records?" (none | own | team | all)
 *  - BOOLEAN — a flat capability, held or not (modelled as none | all)
 */

export const SCOPES = ["none", "own", "team", "all"] as const;
export type Scope = (typeof SCOPES)[number];

/** Ordered weakest → strongest so grants can be merged by taking the max. */
export const SCOPE_RANK: Record<Scope, number> = { none: 0, own: 1, team: 2, all: 3 };

export function maxScope(a: Scope, b: Scope): Scope {
  return SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b;
}

export function scopeAtLeast(actual: Scope, required: Scope): boolean {
  return SCOPE_RANK[actual] >= SCOPE_RANK[required];
}

export type PermissionCategory =
  | "Pipeline"
  | "Agents"
  | "Proposals"
  | "Outreach"
  | "Reminders"
  | "Saved views"
  | "Analysis"
  | "Audit"
  | "Team & access"
  | "Copilot"
  | "Exports";

export interface PermissionDef {
  key: string;
  category: PermissionCategory;
  label: string;
  /** Scoped permissions expose a none/own/team/all selector; booleans are on/off. */
  scoped: boolean;
  /** Surfaced in the editor as a warning — irreversible or externally visible. */
  risk?: "high";
  help?: string;
}

export const PERMISSIONS = [
  // ---- Pipeline -----------------------------------------------------------
  { key: "lead:read", category: "Pipeline", label: "View leads", scoped: true },
  { key: "lead:create", category: "Pipeline", label: "Add leads", scoped: false },
  { key: "lead:update", category: "Pipeline", label: "Edit leads", scoped: true },
  { key: "lead:stage:advance", category: "Pipeline", label: "Move leads between stages", scoped: true },
  { key: "lead:assign", category: "Pipeline", label: "Change lead owner", scoped: true },
  { key: "lead:delete", category: "Pipeline", label: "Delete leads", scoped: true, risk: "high", help: "Permanent." },

  // ---- Agents -------------------------------------------------------------
  { key: "agent:read", category: "Agents", label: "View agents & agencies", scoped: true },
  { key: "agent:create", category: "Agents", label: "Add agents", scoped: false },
  { key: "agent:update", category: "Agents", label: "Edit agents", scoped: true },
  { key: "agent:delete", category: "Agents", label: "Delete agents", scoped: true, risk: "high" },

  // ---- Proposals ----------------------------------------------------------
  { key: "proposal:read", category: "Proposals", label: "View proposals", scoped: true },
  { key: "proposal:manage", category: "Proposals", label: "Add and update proposals", scoped: true, help: "Recording what was quoted and whether it was accepted." },

  // ---- Outreach -----------------------------------------------------------
  { key: "outreach:read", category: "Outreach", label: "View outreach", scoped: true },
  { key: "outreach:compose", category: "Outreach", label: "Draft outreach", scoped: false },
  { key: "outreach:approve", category: "Outreach", label: "Approve outreach", scoped: false, help: "Pairs with sending — keep them apart for review." },
  { key: "outreach:send", category: "Outreach", label: "Send outreach", scoped: true, risk: "high", help: "Leaves the building. Cannot be recalled." },
  { key: "outreach:cancel", category: "Outreach", label: "Cancel outreach", scoped: true },

  // ---- Reminders ----------------------------------------------------------
  { key: "reminder:read", category: "Reminders", label: "View reminders", scoped: true },
  { key: "reminder:update", category: "Reminders", label: "Reschedule reminders", scoped: true },
  { key: "reminder:complete", category: "Reminders", label: "Complete reminders", scoped: true },

  // ---- Saved views --------------------------------------------------------
  { key: "view:read", category: "Saved views", label: "Use saved views", scoped: true },
  { key: "view:create", category: "Saved views", label: "Save views", scoped: false },
  { key: "view:delete", category: "Saved views", label: "Delete saved views", scoped: true },

  // ---- Analysis -----------------------------------------------------------
  { key: "scoring:read", category: "Analysis", label: "View the scoring model", scoped: false },
  { key: "industry:read", category: "Analysis", label: "View industries", scoped: false },
  { key: "tam:read", category: "Analysis", label: "View whitespace & TAM", scoped: false },
  { key: "quality:read", category: "Analysis", label: "View data quality", scoped: false },

  // ---- Audit --------------------------------------------------------------
  { key: "audit:read", category: "Audit", label: "View the activity log", scoped: false },
  { key: "audit:export", category: "Audit", label: "Export the activity log", scoped: false },

  // ---- Team & access ------------------------------------------------------
  { key: "user:read", category: "Team & access", label: "View team members", scoped: false },
  { key: "user:create", category: "Team & access", label: "Create user accounts", scoped: false, risk: "high" },
  { key: "user:update", category: "Team & access", label: "Edit user details", scoped: false, help: "Name and email only — never permissions." },
  { key: "user:deactivate", category: "Team & access", label: "Deactivate users", scoped: false, risk: "high" },
  { key: "profile:read", category: "Team & access", label: "View permission profiles", scoped: false },
  { key: "profile:create", category: "Team & access", label: "Create permission profiles", scoped: false, risk: "high" },
  { key: "profile:update", category: "Team & access", label: "Edit permission profiles", scoped: false, risk: "high" },
  { key: "profile:delete", category: "Team & access", label: "Delete permission profiles", scoped: false, risk: "high" },
  { key: "profile:assign", category: "Team & access", label: "Assign profiles to users", scoped: false, risk: "high", help: "Grants authority. Kept separate from editing user details." },

  // ---- Copilot ------------------------------------------------------------
  { key: "copilot:use", category: "Copilot", label: "Use the copilot", scoped: false },
  { key: "copilot:tool:write", category: "Copilot", label: "Let the copilot make changes", scoped: false, help: "The underlying permission is still checked for each action." },
  { key: "copilot:websearch", category: "Copilot", label: "Let the copilot search the web", scoped: false },
  { key: "copilot:documents", category: "Copilot", label: "Upload documents to the copilot", scoped: false },

  // ---- Exports ------------------------------------------------------------
  { key: "export:csv", category: "Exports", label: "Export CSV", scoped: false },
  { key: "export:excel", category: "Exports", label: "Export Excel", scoped: false },
  { key: "export:pdf", category: "Exports", label: "Export PDF", scoped: false },
] as const satisfies readonly PermissionDef[];

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key) as PermissionKey[];

const BY_KEY = new Map<string, PermissionDef>(PERMISSIONS.map((p) => [p.key, p]));

export function permissionDef(key: PermissionKey): PermissionDef {
  const def = BY_KEY.get(key);
  if (!def) throw new Error(`Unknown permission: ${key}`);
  return def;
}

export function isPermissionKey(key: string): key is PermissionKey {
  return BY_KEY.has(key);
}

export const PERMISSION_CATEGORIES = [
  "Pipeline",
  "Agents",
  "Proposals",
  "Outreach",
  "Reminders",
  "Saved views",
  "Analysis",
  "Audit",
  "Team & access",
  "Copilot",
  "Exports",
] as const satisfies readonly PermissionCategory[];

export function permissionsByCategory(): Array<{ category: PermissionCategory; permissions: PermissionDef[] }> {
  return PERMISSION_CATEGORIES.map((category) => ({
    category,
    permissions: PERMISSIONS.filter((p) => p.category === category),
  }));
}

/** A profile's grants. Absent key = not granted (deny by default). */
export type PermissionMap = Partial<Record<PermissionKey, Scope>>;

/** Grant every permission at full scope — only used for the Administrator profile. */
export function allPermissions(): PermissionMap {
  return Object.fromEntries(PERMISSION_KEYS.map((k) => [k, "all"])) as PermissionMap;
}
