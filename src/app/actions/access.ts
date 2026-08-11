"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/authorize";
import { exceedsAuthority, resolvePermissions } from "@/lib/auth/effective";
import { isPermissionKey, SCOPES, type PermissionKey, type PermissionMap, type Scope } from "@/lib/auth/catalogue";
import { ADMIN_PROFILE_ID, type Assignment, type Profile } from "@/lib/auth/profiles";
import { getProfileStore } from "@/lib/store/profiles";
import { getUserStore } from "@/lib/store/users";
import { hashPassword } from "@/lib/auth/password";
import { logAudit } from "@/lib/store/audit";
import type { AuthzContext } from "@/lib/auth/resolve";

export type AccessActionState = { ok?: boolean; error?: string } | undefined;

const slug = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

/** Permissions arrive as JSON from the editor; validate every key and scope. */
function parsePermissionMap(raw: unknown): PermissionMap | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const out: PermissionMap = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isPermissionKey(key)) return null;
    if (typeof value !== "string" || !SCOPES.includes(value as Scope)) return null;
    if (value === "none") continue;
    out[key] = value as Scope;
  }
  return out;
}

/** Everyone who would still hold the administrator profile after a change. */
async function remainingAdmins(excludeUserId?: string): Promise<number> {
  const users = await getUserStore().list();
  return users.filter((u) => {
    if (u.active === false) return false;
    if (excludeUserId && u.id === excludeUserId) return false;
    const ids = u.assignment?.profileIds ?? (u.role === "admin" ? [ADMIN_PROFILE_ID] : []);
    return ids.includes(ADMIN_PROFILE_ID);
  }).length;
}

/** Nobody may hand out more authority than they hold themselves. */
async function withinAuthority(ctx: AuthzContext, permissions: PermissionMap): Promise<PermissionKey[]> {
  return exceedsAuthority(ctx.effective, permissions);
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

const profileSchema = z.object({
  id: z.string().trim().optional(),
  name: z.string().trim().min(2, "Give the profile a name.").max(60),
  description: z.string().trim().max(200).optional(),
  permissions: z.string(),
});

export async function saveProfile(_prev: AccessActionState, formData: FormData): Promise<AccessActionState> {
  const existingId = String(formData.get("id") ?? "").trim();
  const ctx = await requirePermission(existingId ? "profile:update" : "profile:create");

  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the profile details." };

  const permissions = parsePermissionMap(parsed.data.permissions);
  if (!permissions) return { error: "That permission selection isn't valid." };

  const store = getProfileStore();
  const current = existingId ? await store.get(existingId) : null;
  if (existingId && !current) return { error: "That profile no longer exists." };
  if (current?.system) return { error: "Built-in profiles can't be edited — duplicate one instead." };

  // Editing a profile you hold is how you quietly grant yourself more.
  if (current && ctx.profileIds.includes(current.id) && !ctx.superuser) {
    return { error: "You can't edit a profile that's assigned to you." };
  }

  const over = await withinAuthority(ctx, permissions);
  if (over.length) {
    return { error: `You can't grant permissions you don't hold yourself (${over.join(", ")}).` };
  }

  const id = current?.id ?? `${slug(parsed.data.name) || "profile"}-${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  const profile: Profile = {
    id,
    name: parsed.data.name,
    description: parsed.data.description ?? "",
    permissions,
    system: false,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };

  await store.save(profile);
  await logAudit({
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: current ? "profile.update" : "profile.create",
    entity: "profile",
    entityId: id,
    summary: `${current ? "Updated" : "Created"} profile "${profile.name}" (${Object.keys(permissions).length} permissions)`,
  });

  revalidatePath("/dashboard/team");
  return { ok: true };
}

export async function deleteProfile(_prev: AccessActionState, formData: FormData): Promise<AccessActionState> {
  const ctx = await requirePermission("profile:delete");
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Missing profile." };

  const store = getProfileStore();
  const profile = await store.get(id);
  if (!profile) return { ok: true };
  if (profile.system) return { error: "Built-in profiles can't be deleted." };

  const users = await getUserStore().list();
  const inUse = users.filter((u) => u.assignment?.profileIds.includes(id));
  if (inUse.length) {
    return { error: `${inUse.length} ${inUse.length === 1 ? "person is" : "people are"} still using this profile.` };
  }

  await store.remove(id);
  await logAudit({
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "profile.delete",
    entity: "profile",
    entityId: id,
    summary: `Deleted profile "${profile.name}"`,
  });

  revalidatePath("/dashboard/team");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/** Resolve what an assignment would actually grant, so we can vet it. */
async function grantsOf(assignment: Assignment) {
  const all = await getProfileStore().list();
  const held = assignment.profileIds
    .map((id) => all.find((p) => p.id === id))
    .filter((p): p is Profile => !!p);
  return { held, effective: resolvePermissions(held, assignment) };
}

async function vetAssignment(ctx: AuthzContext, assignment: Assignment): Promise<string | null> {
  const { held, effective } = await grantsOf(assignment);
  if (held.length !== assignment.profileIds.length) return "One of those profiles no longer exists.";
  if (effective.superuser && !ctx.superuser) return "You can't grant administrator access.";
  const over = exceedsAuthority(ctx.effective, effective.permissions);
  if (over.length) return `You can't grant permissions you don't hold yourself (${over.join(", ")}).`;
  return null;
}

const createUserSchema = z.object({
  name: z.string().trim().min(2, "Enter a name.").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email."),
  password: z.string().min(10, "Use at least 10 characters."),
  profileIds: z.string(),
});

export async function createUser(_prev: AccessActionState, formData: FormData): Promise<AccessActionState> {
  const ctx = await requirePermission("user:create");

  const parsed = createUserSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details." };

  const profileIds = parsed.data.profileIds.split(",").map((s) => s.trim()).filter(Boolean);
  if (profileIds.length === 0) return { error: "Choose at least one profile." };

  const assignment: Assignment = { profileIds };
  const problem = await vetAssignment(ctx, assignment);
  if (problem) return { error: problem };

  const store = getUserStore();
  if (await store.findByEmail(parsed.data.email)) return { error: "That email is already registered." };

  const created = await store.create({
    name: parsed.data.name,
    email: parsed.data.email,
    passwordHash: await hashPassword(parsed.data.password),
    assignment,
  });
  // Keep the legacy role aligned so existing session checks stay coherent.
  await store.setRole(created.id, profileIds.includes(ADMIN_PROFILE_ID) ? "admin" : "member");

  await logAudit({
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "user.create",
    entity: "user",
    entityId: created.id,
    summary: `Created ${created.email} with ${profileIds.join(", ")}`,
  });

  revalidatePath("/dashboard/team");
  return { ok: true };
}

export async function assignProfiles(_prev: AccessActionState, formData: FormData): Promise<AccessActionState> {
  const ctx = await requirePermission("profile:assign");

  const id = String(formData.get("id") ?? "").trim();
  const profileIds = String(formData.get("profileIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!id) return { error: "Missing user." };
  if (profileIds.length === 0) return { error: "Choose at least one profile." };
  if (id === ctx.user.id) return { error: "You can't change your own access." };

  const store = getUserStore();
  const target = (await store.list()).find((u) => u.id === id);
  if (!target) return { error: "That user no longer exists." };

  const assignment: Assignment = { profileIds };
  const problem = await vetAssignment(ctx, assignment);
  if (problem) return { error: problem };

  const losingAdmin =
    (target.assignment?.profileIds ?? (target.role === "admin" ? [ADMIN_PROFILE_ID] : [])).includes(ADMIN_PROFILE_ID) &&
    !profileIds.includes(ADMIN_PROFILE_ID);
  if (losingAdmin && (await remainingAdmins(target.id)) === 0) {
    return { error: "That would leave nobody with administrator access." };
  }

  await store.setAssignment(id, assignment);
  await store.setRole(id, profileIds.includes(ADMIN_PROFILE_ID) ? "admin" : "member");

  await logAudit({
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "user.access.change",
    entity: "user",
    entityId: id,
    summary: `Set ${target.email} to ${profileIds.join(", ")}`,
  });

  revalidatePath("/dashboard/team");
  return { ok: true };
}

export async function setUserActive(_prev: AccessActionState, formData: FormData): Promise<AccessActionState> {
  const ctx = await requirePermission("user:deactivate");

  const id = String(formData.get("id") ?? "").trim();
  const active = String(formData.get("active") ?? "") === "true";
  if (!id) return { error: "Missing user." };
  if (id === ctx.user.id) return { error: "You can't deactivate yourself." };

  const store = getUserStore();
  const target = (await store.list()).find((u) => u.id === id);
  if (!target) return { error: "That user no longer exists." };

  if (!active && (await remainingAdmins(target.id)) === 0) {
    return { error: "That would leave nobody with administrator access." };
  }

  await store.setActive(id, active);
  await logAudit({
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: active ? "user.activate" : "user.deactivate",
    entity: "user",
    entityId: id,
    summary: `${active ? "Reactivated" : "Deactivated"} ${target.email}`,
  });

  revalidatePath("/dashboard/team");
  return { ok: true };
}
