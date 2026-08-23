"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/authorize";
import { getBrandStore } from "@/lib/store/brands";
import { getCrmOverlayStore } from "@/lib/store/crm";
import { getCrmGraph } from "@/lib/crm/graph";
import { authorizeLead } from "@/lib/leads/visible";
import { blankLead, freeLeadId } from "@/lib/leads/create";
import { logAudit } from "@/lib/store/audit";
import { advanceStage, todayYmd } from "@/lib/workflow";
import { reconcileImportedOutcome } from "@/lib/lifecycle";
import { writeBudget } from "@/lib/pipeline/budget";
import { writeRubric } from "@/lib/pipeline/rubric";
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

/** The rubric is a 0-5 judgement, half-points included, as the workbook had it. */
const rubricScore = z.preprocess(
  emptyToUndef,
  z.coerce.number().min(0, "Scores run from 0 to 5").max(5, "Scores run from 0 to 5").optional(),
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
  // Set when the lead is started from a company page: the new engagement
  // belongs to that client rather than standing up a company of its own.
  companyId: optionalStr,
  customizationScore: rubricScore,
  accessibilityScore: rubricScore,
  receptivityScore: rubricScore,
  alignmentScore: rubricScore,
  notes: optionalStr,
});

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
  let statusChanged = false;
  if (input.id) {
    const existing = await store.get(input.id);
    if (!existing) return { error: "That lead no longer exists." };
    await authorizeLead(auth, existing);
    brand = { ...existing };
  } else {
    brand = blankLead(await freeLeadId(input.name), input.name);
  }

  brand.name = input.name;
  statusChanged = brand.status !== ((input.status as Brand["status"]) ?? null);
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
  brand = writeRubric(brand, {
    customizationScore: input.customizationScore ?? null,
    accessibilityScore: input.accessibilityScore ?? null,
    receptivityScore: input.receptivityScore ?? null,
    alignmentScore: input.alignmentScore ?? null,
  });
  // Only when the stage actually moved: saving an unrelated edit should not
  // quietly close a review item nobody looked at.
  if (statusChanged) brand = reconcileImportedOutcome(brand);

  await store.save(brand);
  // A lead started from a company page belongs to that client. Without this it
  // would project a brand-new company from its own name, which is how "we
  // closed with them last year, now we are exploring something else" ended up
  // as two unrelated records.
  if (isNew && input.companyId) {
    const graph = await getCrmGraph();
    const target = graph.companies.find((c) => c.id === input.companyId);
    if (target) {
      await getCrmOverlayStore().linkDeal({
        dealId: brand.id,
        companyId: target.id,
        companyName: target.name,
        linkedById: user.id,
        linkedByName: user.name,
        linkedAt: new Date().toISOString(),
      });
      revalidatePath(`/dashboard/companies/${target.id}`);
    }
  }

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
  revalidatePath("/dashboard/quality");
  revalidatePath("/dashboard/industries");
  revalidatePath("/dashboard/whitespace");
  return { ok: true };
}

/**
 * Accept the current stage as the answer, closing an imported-outcome conflict.
 *
 * The alternative reading is that the row holds two engagements, which is
 * resolved by creating the second lead - not here.
 */
export async function resolveOutcomeConflict(
  _prev: BrandActionState,
  formData: FormData,
): Promise<BrandActionState> {
  const auth = await requirePermission("lead:update");
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Missing id." };

  const store = getBrandStore();
  const brand = await store.get(id);
  if (!brand) return { error: "That lead no longer exists." };
  await authorizeLead(auth, brand);

  const reconciled = reconcileImportedOutcome(brand);
  if (reconciled === brand) return { ok: true };

  await store.save(reconciled);
  await logAudit({
    actorId: auth.user.id,
    actorName: auth.user.name,
    action: "brand.update",
    entity: "brand",
    entityId: id,
    summary: `Confirmed ${brand.name} is ${brand.status ?? "unset"}, not the imported outcome`,
  });

  revalidatePath("/dashboard/quality");
  revalidatePath(`/dashboard/pipeline/${id}`);
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

  const next = advanceStage(brand, to, todayYmd());
  if ("error" in next) return { error: next.error };

  await store.save(next);
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
  revalidatePath("/dashboard/quality");
  return { ok: true };
}
