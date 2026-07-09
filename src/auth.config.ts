import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe auth config (no DB / bcrypt imports) so it can run in middleware.
 * The Credentials provider lives in ./auth.ts (Node runtime) — this is the
 * documented NextAuth v5 "split config" pattern for credentials + middleware.
 */
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt" },
  callbacks: {
    // Gate the app: any authenticated user may enter (v1 = everyone edits).
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isProtected = nextUrl.pathname.startsWith("/dashboard");
      if (isProtected) return isLoggedIn;
      return true;
    },
  },
  providers: [], // real providers are added in auth.ts
} satisfies NextAuthConfig;

export default authConfig;
