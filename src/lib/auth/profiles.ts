/**
 * Permission profiles — reusable bundles of grants that get assigned to users.
 *
 * Client-importable (the admin editor renders these as starting points).
 *
 * The seeded profiles below are the migration contract: `Sales rep` is
 * calibrated to reproduce exactly what a `member` can do today, and
 * `Administrator` to reproduce `admin`. Scopes are deliberately left at `all`
 * so switching the system on cannot take access away from anyone — narrowing
 * to own/team is a later, deliberate decision per profile.
 */
import {
  PERMISSION_KEYS,
  allPermissions,
  type PermissionKey,
  type PermissionMap,
  type Scope,
} from "./catalogue";

export interface Profile {
  id: string;
  name: string;
  description: string;
  permissions: PermissionMap;
  /** Bypasses the permission map entirely — never expressed as a wildcard grant. */
  superuser?: boolean;
  /** Seeded profiles cannot be deleted, and the admin one cannot be edited. */
  system: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export const ADMIN_PROFILE_ID = "administrator";
export const SALES_REP_PROFILE_ID = "sales-rep";
export const READ_ONLY_PROFILE_ID = "read-only";

const grant = (keys: readonly PermissionKey[], scope: Scope = "all"): PermissionMap =>
  Object.fromEntries(keys.map((k) => [k, scope])) as PermissionMap;

const READ_KEYS = PERMISSION_KEYS.filter((k) => k.endsWith(":read"));

/** Everything a `member` can do today — the calibration target for migration. */
const SALES_REP_KEYS: PermissionKey[] = [
  "lead:read", "lead:create", "lead:update", "lead:stage:advance", "lead:assign",
  "agent:read", "agent:create", "agent:update", "agent:delete",
  "outreach:read", "outreach:compose", "outreach:cancel",
  "reminder:read", "reminder:update", "reminder:complete",
  "view:read", "view:create", "view:delete",
  "scoring:read", "industry:read", "tam:read", "quality:read",
  "copilot:use", "copilot:tool:write", "copilot:websearch", "copilot:documents",
  "export:csv", "export:excel", "export:pdf",
];

const SALES_MANAGER_KEYS: PermissionKey[] = [
  ...SALES_REP_KEYS,
  "lead:delete",
  "outreach:approve", "outreach:send",
  "audit:read", "audit:export",
  "user:read",
];

const OPERATIONS_KEYS: PermissionKey[] = [
  ...READ_KEYS,
  "view:create", "view:delete",
  "audit:export",
  "copilot:use", "copilot:websearch", "copilot:documents",
  "export:csv", "export:excel", "export:pdf",
];

export const SYSTEM_PROFILES: Profile[] = [
  {
    id: ADMIN_PROFILE_ID,
    name: "Administrator",
    description: "Unrestricted access, including team and permission management.",
    permissions: allPermissions(),
    superuser: true,
    system: true,
  },
  {
    id: "sales-manager",
    name: "Sales manager",
    description: "Runs the pipeline end to end — including approving and sending outreach.",
    permissions: grant(SALES_MANAGER_KEYS),
    system: true,
  },
  {
    id: SALES_REP_PROFILE_ID,
    name: "Sales rep",
    description: "Works leads and drafts outreach. Cannot send it or delete leads.",
    permissions: grant(SALES_REP_KEYS),
    system: true,
  },
  {
    id: "operations",
    name: "Operations & analysis",
    description: "Reads everything and exports it. Makes no changes to the pipeline.",
    permissions: grant(OPERATIONS_KEYS),
    system: true,
  },
  {
    id: READ_ONLY_PROFILE_ID,
    name: "Read only",
    description: "Can look, but change nothing. The safe default.",
    permissions: grant(READ_KEYS),
    system: true,
  },
];

export function systemProfile(id: string): Profile | null {
  return SYSTEM_PROFILES.find((p) => p.id === id) ?? null;
}

/** What a user is granted: profiles plus optional per-user adjustments. */
export interface Assignment {
  profileIds: string[];
  /** Added on top of the profiles — the "custom on the spot" case. */
  grantOverrides?: PermissionMap;
  /** Removed regardless of what the profiles grant. Deny always wins. */
  denyOverrides?: PermissionKey[];
}

export const EMPTY_ASSIGNMENT: Assignment = { profileIds: [] };
