import "server-only";
import { cache } from "react";
import { getBrands } from "@/lib/data";
import { getAuthzContext } from "@/lib/auth/resolve";
import { authorizeRecord, type Authorized } from "@/lib/auth/authorize";
import { scopeFor } from "@/lib/auth/effective";
import { ownerIdResolver } from "@/lib/crm/owners";
import type { Brand } from "@/lib/types";

/**
 * Who may see and touch which leads.
 *
 * Reads and writes live together so "own" means one thing. A lead carries an
 * owner's display name rather than a user id, so deciding ownership needs the
 * resolver; splitting that across two modules is how the read gate and the
 * write gate drift apart.
 *
 * `getBrands()` is the raw store read and stays that way for system work
 * (migration, seeding). Anything rendered for a person should come through
 * here, or a record scope becomes decorative: enforcing it on the pipeline
 * list alone still leaks the same rows through KPIs, reminders, exports and
 * the copilot.
 */
export const getVisibleBrands = cache(async (): Promise<Brand[]> => {
  const all = await getBrands();
  const ctx = await getAuthzContext();
  if (!ctx) return [];

  const scope = scopeFor(ctx.effective, "lead:read");
  if (scope === "none") return [];
  if (ctx.superuser || scope === "all") return all;

  // `own` and `team` both collapse to "mine" until teams exist.
  const resolveOwner = await ownerIdResolver();
  return all.filter((b) => resolveOwner(b.owner) === ctx.user.id);
});

export async function getVisibleScoredBrands(): Promise<Brand[]> {
  return (await getVisibleBrands()).filter((b) => b.scored && b.scores);
}

/** True when the viewer may see this specific lead — for detail routes. */
export async function canSeeBrand(brand: Pick<Brand, "owner">): Promise<boolean> {
  const ctx = await getAuthzContext();
  if (!ctx) return false;
  const scope = scopeFor(ctx.effective, "lead:read");
  if (scope === "none") return false;
  if (ctx.superuser || scope === "all") return true;
  const resolveOwner = await ownerIdResolver();
  return resolveOwner(brand.owner) === ctx.user.id;
}

/**
 * Throws unless the caller may act on this lead.
 *
 * Judged against the scope the *write* permission resolved to, not the read
 * one. Holding `lead:read: all` with `lead:update: own` is a coherent thing to
 * configure — look at everything, change only yours — and finding the record
 * through a read-scoped lookup would silently grant the wider of the two.
 *
 * Call it immediately after loading the record and before touching it: a
 * capability check proves the caller may edit *a* lead, never *this* lead.
 */
export async function authorizeLead(auth: Authorized, lead: Pick<Brand, "owner">): Promise<void> {
  const resolveOwner = await ownerIdResolver();
  // A lead whose owner does not resolve to a user has no owner to match, so a
  // scoped caller is refused rather than let through.
  authorizeRecord(auth, auth.scope, { ownerId: resolveOwner(lead.owner) });
}
