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

/** Require any authenticated user; throws otherwise (guards server actions). */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("Unauthorized");
  return user;
}

/** Require an admin; throws for members and anonymous callers. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") throw new Error("Forbidden: this action is admin-only.");
  return user;
}
