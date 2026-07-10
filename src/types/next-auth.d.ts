import type { DefaultSession } from "next-auth";
import type { UserRole } from "@/lib/auth/roles";

// Carry the app user id + role through the JWT session.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
    } & DefaultSession["user"];
  }
  interface User {
    role?: UserRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: UserRole;
  }
}
