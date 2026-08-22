"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/authorize";
import { getBrandStore } from "@/lib/store/brands";
import { getCrmOverlayStore } from "@/lib/store/crm";
import { authorizeLead } from "@/lib/leads/visible";
import { logAudit } from "@/lib/store/audit";
import { canTransition, statusSideEffects, todayYmd } from "@/lib/workflow";
import { writeBudget } from "@/lib/pipeline/budget";
import { BRAND_STATUSES, PRIORITIES, INDUSTRIES } from "@/lib/vocab";
import { STRATEGIC_REASONS } from "@/lib/priority";
import type { Brand, BrandStatus } from "@/lib/types";

export type BrandActionState = { ok?: boolean; error?: string } | undefined;

const emptyToUndef = (v: unknown) => (v === "" || v == null ? undefined : v);
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(emptyToUndef, z.enum(values).optional());
const optionalStr = z.preprocess(emptyToUndef, z.string().trim().optional());
const optionalDate = z.preprocess(
  emptyToUndef,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional(),
);

const brandInputSchema = z.object({
  id: optionalStr,
  name: z.string().trim().min(1, "Name is required").max(120),
  status: optionalEnum(BRAND_STATUSES as unknown as [string, ...string[]]),
  priority: optionalEnum(PRIORITIES as unknown as [string, ...string[]]),
  industry: optionalEnum(INDUSTRIES as unknown as [string, ...string[]]),
  owner: optionalStr,
  poc: optionalStr,
  email: z.preprocess(emptyToUndef, z.string().trim().email("Enter a valid email").optional()),
  initialContact: optionalDate,
  lastContact: optionalDate,
  followUpDate: optionalDate,
  closingFailed: optionalDate,
  waitingOn: optionalEnum(["us", "them"]),
  nextStep: optionalStr,
  // Chosen from a list rather than typed, so "strategic" cannot be argued into
  // meaning anything a lead needs it to mean.
  strategicValue: z.preprocess(emptyToUndef, z.coerce.number().int().min(0).max(3).optional()),
  strategicReason: optionalEnum(STRATEGIC_REASONS as unknown as [string, ...string[]]),
  // The estimate made when the lead opened: "a slow enterprise, call it 8 months".
  expectedMonths: z.preprocess(
    emptyToUndef,
    z.coerce.number().min(0, "Months cannot be negative").max(60, "That is over five years").optional(),
  ),
  // Asked for at creation so a lead is worth something from day one: without
  // it the lead had no score record at all, and an accepted proposal had
  // nowhere to land.
  budget: z.preprocess(
    emptyToUndef,
    z.coerce.number().min(0, "Value cannot be negative").max(1_000_000_000, "That figure looks wrong").optional(),
  ),
  assumption: optionalEnum(["Estimated", "Confirmed"]),
  notes: optionalStr,
});

function slug(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .toLowerCase() || "lead"
  );
}

export async function saveBrand(_prev: BrandActionState, formData: FormData): Promise<BrandActionState> {
  // Pure read of the submitted id: decides which capability the write needs.
  const isNew = !String(formData.get("id") ?? "").trim();
  const auth = await requirePermission(isNew ? "lead:create" : "lead:update");
  const { user } = auth;

  const parsed = brandInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }
  const input = parsed.data;
  const store = getBrandStore();

  let brand: Brand;
  if (input.id) {
    const existing = await store.get(input.id);
    if (!existing) return { error: "That lead no longer exists." };
    await authorizeLead(auth, existing);
    brand = { ...existing };
  } else {
    let id = slug(input.name);
    if (await store.get(id)) id = `${id}-${Date.now().toString(36).slice(-4)}`;
    brand = {
      id,
      name: input.name,
      aliases: [],
      scored: false,
      status: null,
      priority: null,
      owner: null,
      poc: null,
      email: null,
      industry: null,
      industryRaw: null,
      initialContact: null,
      lastContact: null,
      followUpDate: null,
      waitingOn: null,
      nextStep: null,
      expectedMonths: null,
      strategicValue: 0,
      strategicReason: null,
      closingFailed: null,
      notes: null,
    };
  }

  brand.name = input.name;
  brand.status = (input.status as Brand["status"]) ?? null;
  brand.priority = (input.priority as Brand["priority"]) ?? null;
  brand.industry = (input.industry as Brand["industry"]) ?? null;
  // industryRaw records what the import actually said, so an edit must not
  // overwrite it with the normalised enum.
  brand.industryRaw = brand.industryRaw ?? (input.industry as string) ?? null;
  brand.owner = input.owner ?? null;
  brand.poc = input.poc ?? null;
  brand.email = input.email ?? null;
  brand.initialContact = input.initialContact ?? null;
  brand.lastContact = input.lastContact ?? null;
  brand.followUpDate = input.followUpDate ?? null;
  brand.waitingOn = (input.waitingOn as Brand["waitingOn"]) ?? null;
  brand.nextStep = input.nextStep ?? null;
  brand.strategicValue = input.strategicValue ?? 0;
  brand.strategicReason = input.strategicReason ?? null;
  brand.expectedMonths = input.expectedMonths ?? null;
  brand.closingFailed = input.closingFailed ?? null;
  brand.notes = input.notes ?? null;
  // Last, so it sees the industry this edit just set when it has to build a
  // score record from nothing.
  brand = writeBudget(
    brand,
    input.budget ?? null,
    (input.assumption as "Confirmed" | "Estimated" | undefined) ?? (input.budget == null ? null : "Estimated"),
  );

  await store.save(brand);
  await logAudit({
    actorId: user.id,
    actorName: user.name,
    action: isNew ? "brand.create" : "brand.update",
    entity: "brand",
    entityId: brand.id,
    summary: `${isNew ? "Created" : "Updated"} lead ${brand.name}`,
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/pipeline");
  revalidatePath(`/dashboard/pipeline/${brand.id}`);
  revalidatePath("/dashboard/scoring");
  // Companies and their rollups are projected from leads, so an edit moves them.
  revalidatePath("/dashboard/companies");
  return { ok: true };
}

export async function deleteBrand(_prev: BrandActionState, formData: FormData): Promise<BrandActionState> {
  const auth = await requirePermission("lead:delete");
  const { user } = auth;
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Missing id." };

  const existing = await getBrandStore().get(id);
  if (existing) await authorizeLead(auth, existing);
  await getBrandStore().remove(id);
  // Lead ids are name slugs and the collision check only looks at live leads,
  // so recreating a deleted lead reuses its id. Without this, the new lead
  // would inherit the dead one's proposals and company link.
  await getCrmOverlayStore().purgeDeal(id);
  await logAudit({
    actorId: user.id,
    actorName: user.name,
    action: "brand.delete",
    entity: "brand",
    entityId: id,
    summary: `Deleted lead ${existing?.name ?? id}`,
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/pipeline");
  revalidatePath("/dashboard/scoring");
  revalidatePath("/dashboard/companies");
  return { ok: true };
}

const statusChangeSchema = z.object({
  id: z.string().min(1),
  status: z.enum(BRAND_STATUSES as unknown as [string, ...string[]]),
});

/** Advance a lead through the pipeline, enforcing the allowed-transition graph. */
export async function changeBrandStatus(
  _prev: BrandActionState,
  formData: FormData,
): Promise<BrandActionState> {
  const auth = await requirePermission("lead:stage:advance");
  const { user } = auth;

  const parsed = statusChangeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid status." };
  const { id } = parsed.data;
  const to = parsed.data.status as BrandStatus;

  const store = getBrandStore();
  const brand = await store.get(id);
  if (!brand) return { error: "That lead no longer exists." };
  await authorizeLead(auth, brand);

  const from = brand.status;
  if (from === to) return { ok: true };
  if (!canTransition(from, to)) {
    return { error: `Can't move from ${from ?? "unset"} to ${to}.` };
  }

  const patch = statusSideEffects(brand, to, todayYmd());
  await store.save({ ...brand, status: to, ...patch });
  await logAudit({
    actorId: user.id,
    actorName: user.name,
    action: "status.change",
    entity: "brand",
    entityId: id,
    summary: `Moved ${brand.name}: ${from ?? "unset"} \u2192 ${to}`,
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/pipeline");
  revalidatePath(`/dashboard/pipeline/${id}`);
  revalidatePath("/dashboard/companies");
  return { ok: true };
}
