import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { requirePermission, type Authorized } from "./authorize";
import { ForbiddenError, UnauthorizedError } from "./errors";
import type { PermissionKey, Scope } from "./catalogue";

/**
 * The route-handler form of `requirePermission`.
 *
 * Route handlers are POST endpoints the browser reaches directly, exactly like
 * server actions, but they answer with a status code instead of throwing to an
 * error boundary. This wraps the one authorization decision rather than
 * restating it, so routes inherit shadow mode and the denial audit trail for
 * free and there is a single place where the verdict is made.
 *
 *   const gate = await apiPermission("copilot:use");
 *   if (gate instanceof Response) return gate;
 */
export async function apiPermission(
  permission: PermissionKey,
  minimum: Scope = "own",
): Promise<Authorized | Response> {
  try {
    return await requirePermission(permission, minimum);
  } catch (e) {
    // Neither body names the permission: a probe should not learn the shape of
    // the model from the refusals.
    if (e instanceof UnauthorizedError) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (e instanceof ForbiddenError) return Response.json({ error: "Forbidden" }, { status: 403 });
    throw e;
  }
}

/**
 * Compare a presented API key against the configured one without leaking its
 * contents through timing. Both sides are hashed first so the comparison is
 * over equal-length buffers — `timingSafeEqual` throws on a length mismatch,
 * and the length of a secret is itself worth hiding.
 */
export function apiKeyMatches(presented: string | null | undefined, expected: string | undefined): boolean {
  if (!expected || !presented) return false;
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(presented), digest(expected));
}
