import "server-only";
import { cache } from "react";
import { getSessionUser, type SessionUser } from "./guards";
import { resolvePermissions, type EffectivePermissions } from "./effective";
import { currentPrincipal } from "./principal";
import { getProfileStore } from "@/lib/store/profiles";
import { getUserStore } from "@/lib/store/users";
import {
  ADMIN_PROFILE_ID,
  READ_ONLY_PROFILE_ID,
  SALES_REP_PROFILE_ID,
  SYSTEM_PROFILES,
  EMPTY_ASSIGNMENT,
  type Assignment,
  type Profile,
} from "./profiles";

export interface AuthzContext {
  user: SessionUser;
  effective: EffectivePermissions;
  superuser: boolean;
  /** Profiles the user currently holds - used to stop self-escalation via editing. */
  profileIds: string[];
  /** Reserved for team-scoped grants; empty until teams exist. */
  teamIds: string[];
}

/**
 * Break-glass recovery. Resolves to Administrator without touching the store,
 * so a corrupted profile or a bad edit can never lock the org out entirely.
 */
function isBreakGlass(email: string): boolean {
  const configured = process.env.BREAKGLASS_ADMIN_EMAIL?.trim().toLowerCase();
  return !!configured && configured === email.trim().toLowerCase();
}

/**
 * Derive an assignment for accounts written before profiles existed.
 *
 * The fallback chain is deliberate: a stored assignment wins, else the legacy
 * role maps onto its equivalent seeded profile, else read-only. It never
 * resolves to nothing, so a half-finished migration degrades to today's
 * behaviour rather than locking someone out.
 */
export function assignmentForLegacyRole(role: string | null | undefined): Assignment {
  if (role === "admin") return { profileIds: [ADMIN_PROFILE_ID] };
  if (role === "member") return { profileIds: [SALES_REP_PROFILE_ID] };
  return { profileIds: [READ_ONLY_PROFILE_ID] };
}

async function loadProfiles(ids: string[]): Promise<Profile[]> {
  if (ids.length === 0) return [];
  let stored: Profile[] = [];
  try {
    stored = await getProfileStore().list();
  } catch {
    stored = [];
  }
  const byId = new Map<string, Profile>();
  for (const p of SYSTEM_PROFILES) byId.set(p.id, p);
  for (const p of stored) byId.set(p.id, p); // stored edits win over the constants
  return ids.map((id) => byId.get(id)).filter((p): p is Profile => !!p);
}

async function resolveForUser(user: SessionUser): Promise<AuthzContext> {
  if (isBreakGlass(user.email)) {
    const admin = SYSTEM_PROFILES.find((p) => p.id === ADMIN_PROFILE_ID)!;
    return {
      user,
      effective: resolvePermissions([admin], EMPTY_ASSIGNMENT),
      superuser: true,
      profileIds: [ADMIN_PROFILE_ID],
      teamIds: [],
    };
  }

  let assignment: Assignment | null = null;
  try {
    const stored = await getUserStore().findById(user.id);
    assignment = stored?.assignment ?? assignmentForLegacyRole(stored?.role ?? user.role);
  } catch {
    // Store unreachable - fall back to the session's own role rather than denying.
    assignment = assignmentForLegacyRole(user.role);
  }

  const profiles = await loadProfiles(assignment.profileIds);
  const effective = resolvePermissions(profiles, assignment);
  return { user, effective, superuser: effective.superuser, profileIds: assignment.profileIds, teamIds: [] };
}

/** Cached per request, so a page with many guarded reads pays for one lookup. */
const getSessionAuthzContext = cache(async (): Promise<AuthzContext | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  return resolveForUser(user);
});

/**
 * The caller's permissions, however they authenticated.
 *
 * An explicitly bound principal wins over the session because it is the
 * narrower claim: it is only ever established by a route that has already
 * verified a credential the session does not carry.
 */
export async function getAuthzContext(): Promise<AuthzContext | null> {
  return currentPrincipal() ?? getSessionAuthzContext();
}

/**
 * What to call the caller in the UI.
 *
 * The badge in the top bar used to read `user.role` off the session. That
 * stopped being the truth the day profiles landed: granting someone the
 * Administrator profile writes an assignment and never touches the legacy
 * role, so the Team panel called them Administrator while the top bar called
 * them Member. Resolve it from the profiles, which is what actually decides
 * what they can do.
 */
export async function accessLabel(): Promise<{ label: string; elevated: boolean }> {
  const ctx = await getAuthzContext();
  if (!ctx) return { label: "Member", elevated: false };
  const profiles = await loadProfiles(ctx.profileIds);
  const label = profiles.map((p) => p.name).join(", ");
  return {
    label: label || (ctx.superuser ? "Admin" : "Member"),
    elevated: ctx.superuser || profiles.some((p) => p.superuser),
  };
}

