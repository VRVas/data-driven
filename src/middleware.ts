import NextAuth from "next-auth";
import authConfig from "@/auth.config";

// Edge-safe middleware: uses the split config (no bcrypt / Cosmos imports).
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Protect the app; leave marketing, auth pages and static assets public.
  matcher: ["/dashboard/:path*"],
};
