import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthzContext } from "./resolve";

/**
 * An authorization context established by the caller rather than read from a
 * session cookie.
 *
 * Machine callers (the Foundry agent hitting /api/copilot/tools with an API
 * key) have no session, so every session-derived check below them resolves to
 * "logged out". Passing the identity as a function argument does not fix that:
 * the helpers that actually gate data — getAuthzContext, can, getVisibleBrands
 * — take no caller argument, and threading one through every tool would leave
 * the guarantee resting on nobody forgetting. Binding it to the async context
 * means the same code path serves both channels.
 */
const storage = new AsyncLocalStorage<AuthzContext>();

/** The explicitly bound principal, or undefined when the caller has a session. */
export function currentPrincipal(): AuthzContext | undefined {
  return storage.getStore();
}

/**
 * Run `fn` with `principal` as the authorization context. Scoped to this call:
 * it cannot leak into another request, and it ends when `fn` settles.
 */
export function runAsPrincipal<T>(principal: AuthzContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(principal, fn);
}
