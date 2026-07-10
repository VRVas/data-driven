/**
 * Role vocabulary + tiny helpers. Kept free of `server-only` so it can be
 * imported from the edge-safe auth config and from client components.
 */
export type UserRole = "admin" | "member";

export const ROLES: readonly UserRole[] = ["admin", "member"];

export function isAdmin(role: UserRole | null | undefined): boolean {
  return role === "admin";
}

export function roleLabel(role: UserRole | null | undefined): string {
  return role === "admin" ? "Admin" : "Member";
}
