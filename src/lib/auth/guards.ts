import "server-only";
import { auth } from "@/auth";
import type { UserRole } from "./roles";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

/** The signed-in user (from the JWT session), or null when logged out. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const u = session?.user;
  if (!u) return null;
  return {
    id: (u.id as string) ?? "",
    email: u.email ?? "",
    name: u.name ?? "",
    role: (u.role as UserRole) ?? "member",
  };
}

// The old requireUser/requireAdmin guards are gone — authorization now goes
// through requirePermission() in ./authorize so every call names a capability.
