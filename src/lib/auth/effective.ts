/**
 * Pure permission resolution — how profiles and per-user overrides combine into
 * one effective grant map. No I/O, so it can be unit-tested exhaustively and
 * reused by the admin editor to preview a profile before saving it.
 *
 * Rules, in order:
 *  1. Deny by default — an absent key grants nothing.
 *  2. Profiles are additive; overlapping grants take the strongest scope.
 *  3. Per-user grants are added on top (the "custom on the spot" case).
 *  4. An explicit deny always wins, whatever any profile says.
 *  5. Superuser short-circuits everything — it is a flag, not a wildcard grant,
 *     so no string matching can ever accidentally confer it.
 */
import { isPermissionKey, maxScope, scopeAtLeast, type PermissionKey, type PermissionMap, type Scope } from "./catalogue";
import type { Assignment, Profile } from "./profiles";

export interface EffectivePermissions {
  permissions: PermissionMap;
  superuser: boolean;
}

export function resolvePermissions(profiles: Profile[], assignment: Assignment): EffectivePermissions {
  const superuser = profiles.some((p) => p.superuser === true);
  const permissions: PermissionMap = {};

  for (const profile of profiles) {
    for (const [key, scope] of Object.entries(profile.permissions)) {
      if (!isPermissionKey(key) || !scope || scope === "none") continue;
      const k = key as PermissionKey;
      permissions[k] = permissions[k] ? maxScope(permissions[k]!, scope) : scope;
    }
  }

  for (const [key, scope] of Object.entries(assignment.grantOverrides ?? {})) {
    if (!isPermissionKey(key) || !scope || scope === "none") continue;
    const k = key as PermissionKey;
    permissions[k] = permissions[k] ? maxScope(permissions[k]!, scope) : scope;
  }

  for (const key of assignment.denyOverrides ?? []) {
    delete permissions[key];
  }

  return { permissions, superuser };
}

export function scopeFor(effective: EffectivePermissions, key: PermissionKey): Scope {
  if (effective.superuser) return "all";
  return effective.permissions[key] ?? "none";
}

export function can(effective: EffectivePermissions, key: PermissionKey, required: Scope = "own"): boolean {
  return scopeAtLeast(scopeFor(effective, key), required);
}

/**
 * Nobody may grant more than they already hold. Prevents an admin-adjacent user
 * from writing themselves a profile that exceeds their own authority.
 */
export function exceedsAuthority(
  actor: EffectivePermissions,
  requested: PermissionMap,
): PermissionKey[] {
  if (actor.superuser) return [];
  const over: PermissionKey[] = [];
  for (const [key, scope] of Object.entries(requested)) {
    if (!isPermissionKey(key) || !scope || scope === "none") continue;
    if (!scopeAtLeast(scopeFor(actor, key), scope)) over.push(key);
  }
  return over;
}
