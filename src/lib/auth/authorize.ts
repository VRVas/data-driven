import "server-only";
import { getAuthzContext, type AuthzContext } from "./resolve";
import { ForbiddenError, UnauthorizedError } from "./errors";
import { scopeFor, can as canDo, type EffectivePermissions } from "./effective";
import { scopeAtLeast, type PermissionKey, type Scope } from "./catalogue";
import { logAudit } from "@/lib/store/audit";

/**
 * Shadow mode: compute and log the verdict, but let the request through.
 * Lets enforcement run against real traffic before it can lock anyone out.
 * Default is ON (enforcing); set RBAC_ENFORCE=false to observe only.
 */
function enforcing(): boolean {
  return process.env.RBAC_ENFORCE !== "false";
}

async function denied(ctx: AuthzContext, permission: PermissionKey, detail: string): Promise<void> {
  await logAudit({
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "authz.denied",
    entity: "permission",
    entityId: permission,
    summary: `${enforcing() ? "Denied" : "Would deny"} ${ctx.user.email}: ${detail}`,
  }).catch(() => undefined);
}

export interface Authorized extends AuthzContext {
  /** The strongest scope the caller holds for the checked permission. */
  scope: Exclude<Scope, "none">;
}

/**
 * Capability gate. Must be the first statement of every server action and
 * route handler - the CI guard test fails the build otherwise.
 */
export async function requirePermission(
  permission: PermissionKey,
  minimum: Scope = "own",
): Promise<Authorized> {
  const ctx = await getAuthzContext();
  if (!ctx) throw new UnauthorizedError();

  const scope = scopeFor(ctx.effective, permission);
  if (!scopeAtLeast(scope, minimum)) {
    await denied(ctx, permission, `lacks ${permission} (has "${scope}", needs "${minimum}")`);
    if (enforcing()) throw new ForbiddenError();
    return { ...ctx, scope: "all" };
  }
  return { ...ctx, scope: scope as Exclude<Scope, "none"> };
}

/** Any signed-in user, no specific capability - for genuinely public-to-staff reads. */
export async function requireSignedIn(): Promise<AuthzContext> {
  const ctx = await getAuthzContext();
  if (!ctx) throw new UnauthorizedError();
  return ctx;
}

export interface OwnedRecord {
  ownerId?: string | null;
  teamId?: string | null;
}

/**
 * Record gate. Call immediately after loading a record, before returning or
 * mutating it - a capability check alone does not prove access to *this* row.
 */
export function authorizeRecord(ctx: AuthzContext, scope: Scope, record: OwnedRecord): void {
  if (ctx.superuser || scope === "all") return;
  if (scope === "team" && record.teamId && ctx.teamIds.includes(record.teamId)) return;
  if ((scope === "team" || scope === "own") && record.ownerId && record.ownerId === ctx.user.id) return;
  throw new ForbiddenError();
}

/** List gate - apply inside the query/filter, never in the component. */
export function scopeFilter<T extends OwnedRecord>(
  ctx: AuthzContext,
  scope: Scope,
): (record: T) => boolean {
  if (ctx.superuser || scope === "all") return () => true;
  if (scope === "none") return () => false;
  return (record) => {
    if (scope === "team" && record.teamId && ctx.teamIds.includes(record.teamId)) return true;
    return !!record.ownerId && record.ownerId === ctx.user.id;
  };
}

/** Non-throwing check, for deciding what to render. */
export async function can(permission: PermissionKey, minimum: Scope = "own"): Promise<boolean> {
  const ctx = await getAuthzContext();
  if (!ctx) return false;
  return canDo(ctx.effective, permission, minimum);
}

/** Bulk capability map for passing into client components. */
export async function capabilities<K extends PermissionKey>(
  keys: readonly K[],
): Promise<Record<K, boolean>> {
  const ctx = await getAuthzContext();
  const empty = Object.fromEntries(keys.map((k) => [k, false])) as Record<K, boolean>;
  if (!ctx) return empty;
  return Object.fromEntries(keys.map((k) => [k, canDo(ctx.effective, k)])) as Record<K, boolean>;
}

export type { EffectivePermissions };
