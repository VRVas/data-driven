/**
 * Stand-in for `@/auth` in unit tests.
 *
 * The real module boots NextAuth, which imports `next/server` - unresolvable
 * under the plain Node test environment. Unit tests only need the auth-aware
 * modules to *load*; anything that actually asserts on permissions builds its
 * own context and calls the pure helpers in `@/lib/auth/effective` directly.
 *
 * Returning a null session means "logged out", so any accidental call goes
 * down the deny path rather than silently inventing a privileged user.
 */
export async function auth(): Promise<null> {
  return null;
}

export const handlers = {};
export async function signIn(): Promise<never> {
  throw new Error("signIn() is not available in unit tests");
}
export async function signOut(): Promise<never> {
  throw new Error("signOut() is not available in unit tests");
}
