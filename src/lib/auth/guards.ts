import "server-only";
import { auth } from "@/auth";
import type { UserRole } from "./roles";
import { recoveryState } from "@/lib/recovery/control";

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
  const state = await recoveryState();
  if (state.mode !== "ready" || (u.dataEpoch ?? 0) !== state.epoch) return null;
  return {
    id: (u.id as string) ?? "",
    email: u.email ?? "",
    name: u.name ?? "",
    role: (u.role as UserRole) ?? "member",
  };
}

// The old requireUser/requireAdmin guards are gone - authorization now goes
// through requirePermission() in ./authorize so every call names a capability.
