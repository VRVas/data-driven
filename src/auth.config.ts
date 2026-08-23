import type { NextAuthConfig } from "next-auth";
import type { UserRole } from "@/lib/auth/roles";

/**
 * Edge-safe auth config (no DB / bcrypt imports) so it can run in middleware.
 * The Credentials provider lives in ./auth.ts (Node runtime) - this is the
 * documented NextAuth v5 "split config" pattern for credentials + middleware.
 */
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt" },
  callbacks: {
    // Gate the app: any authenticated user may enter (everyone can edit; roles
    // gate destructive + admin-only actions at the server-action layer).
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isProtected = nextUrl.pathname.startsWith("/dashboard");
      if (isProtected) return isLoggedIn;
      return true;
    },
    // Persist the app user id + role onto the token at sign-in.
    jwt({ token, user }) {
      if (user) {
        token.id = user.id ?? token.id;
        token.role = (user as { role?: UserRole }).role ?? "member";
      }
      return token;
    },
    // Expose id + role to the session consumed across the app.
    session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string) ?? "";
        session.user.role = (token.role as UserRole) ?? "member";
      }
      return session;
    },
  },
  providers: [], // real providers are added in auth.ts
} satisfies NextAuthConfig;

export default authConfig;
