import "server-only";
import { cache } from "react";
import { getBrands } from "@/lib/data";
import { getAuthzContext } from "@/lib/auth/resolve";
import { scopeFor } from "@/lib/auth/effective";
import { ownerIdResolver } from "@/lib/crm/owners";
import type { Brand } from "@/lib/types";

/**
 * Leads the current viewer is allowed to see.
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
