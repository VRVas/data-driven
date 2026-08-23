import "server-only";
import { getBrandStore } from "@/lib/store/brands";
import type { Brand } from "@/lib/types";

/**
 * Making a lead, in one place.
 *
 * The form and the copilot both create leads. Two implementations would drift
 * on the things that are easy to get subtly wrong - the id, and which fields a
 * brand-new lead is allowed to claim.
 */

/** Ids are readable name slugs, which is why they can collide. */
export function leadSlug(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .toLowerCase() || "lead"
  );
}

/**
 * A free id for this name. The suffix only appears on a genuine collision, so
 * the common case stays readable.
 */
export async function freeLeadId(name: string): Promise<string> {
  const base = leadSlug(name);
  const store = getBrandStore();
  if (!(await store.get(base))) return base;
  for (let i = 0; i < 50; i++) {
    const candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    if (!(await store.get(candidate))) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** A new lead claims nothing it has not been told. */
export function blankLead(id: string, name: string): Brand {
  return {
    id,
    name,
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
