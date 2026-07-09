"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { getBrandStore } from "@/lib/store/brands";
import { BRAND_STATUSES, PRIORITIES, INDUSTRIES } from "@/lib/vocab";
import type { Brand } from "@/lib/types";

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
  initialContact: optionalDate,
  lastContact: optionalDate,
  followUp: optionalDate,
  closingFailed: optionalDate,
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

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
}

export async function saveBrand(_prev: BrandActionState, formData: FormData): Promise<BrandActionState> {
  await requireUser();

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
      industry: null,
      industryRaw: null,
      initialContact: null,
      lastContact: null,
      followUp: null,
      closingFailed: null,
      notes: null,
    };
  }

  brand.name = input.name;
  brand.status = (input.status as Brand["status"]) ?? null;
  brand.priority = (input.priority as Brand["priority"]) ?? null;
  brand.industry = (input.industry as Brand["industry"]) ?? null;
  brand.industryRaw = (input.industry as string) ?? brand.industryRaw ?? null;
  brand.owner = input.owner ?? null;
  brand.poc = input.poc ?? null;
  brand.initialContact = input.initialContact ?? null;
  brand.lastContact = input.lastContact ?? null;
  brand.followUp = input.followUp ?? null;
  brand.closingFailed = input.closingFailed ?? null;
  brand.notes = input.notes ?? null;

  await store.save(brand);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/pipeline");
  revalidatePath("/dashboard/scoring");
  return { ok: true };
}

export async function deleteBrand(_prev: BrandActionState, formData: FormData): Promise<BrandActionState> {
  await requireUser();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Missing id." };

  await getBrandStore().remove(id);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/pipeline");
  revalidatePath("/dashboard/scoring");
  return { ok: true };
}
