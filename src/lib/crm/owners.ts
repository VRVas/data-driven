import "server-only";
import { cache } from "react";
import { getUserStore } from "@/lib/store/users";

/**
 * Leads carry an owner's display name, not a user id, so record-level scopes
 * had nothing reliable to match on. This maps one to the other by name.
 *
 * Best effort by design: an unmatched name resolves to null, which means a
 * user restricted to their own records simply won't see that lead. That is the
 * safe direction to fail, and it is why the seeded profiles all grant `all` -
 * narrowing a scope is a deliberate decision, never a migration side-effect.
 */
export const ownerIdResolver = cache(async (): Promise<(ownerName: string | null | undefined) => string | null> => {
  let byName = new Map<string, string>();
  try {
    const users = await getUserStore().list();
    byName = new Map(users.filter((u) => u.name).map((u) => [u.name.trim().toLowerCase(), u.id]));
  } catch {
    byName = new Map();
  }
  return (ownerName) => {
    if (!ownerName) return null;
    return byName.get(ownerName.trim().toLowerCase()) ?? null;
  };
});
