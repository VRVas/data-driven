import "server-only";
import { getCrmOverlayStore } from "@/lib/store/crm";
import { getCrmGraph } from "./graph";
import { authorizeLead } from "@/lib/leads/visible";
import type { Authorized } from "@/lib/auth/authorize";

/**
 * Folding one company into another, in one place.
 *
 * Companies are projected from their deals, so there is no company record to
 * rewrite: re-pointing every deal at the survivor IS the merge, and a company
 * with nothing left simply stops existing. Undo is the existing per-deal
 * unlink.
 *
 * The screens and the copilot both offer this, and the authorisation rule is
 * the part that must not be reimplemented - see below.
 */
export interface MergeResult {
  sourceName: string;
  targetName: string;
  movedDealIds: string[];
}

export async function mergeCompanyInto(
  auth: Authorized,
  sourceId: string,
  targetId: string,
): Promise<MergeResult | { error: string }> {
  if (sourceId === targetId) return { error: "Pick two different companies." };

  const graph = await getCrmGraph();
  const source = graph.companies.find((c) => c.id === sourceId);
  const target = graph.companies.find((c) => c.id === targetId);
  if (!source) return { error: "That company no longer exists." };
  if (!target) return { error: "The company you are merging into no longer exists." };

  const moving = graph.deals.filter((d) => d.companyId === sourceId);
  // Checked before anything is written: a merge that moved the deals it could
  // reach and skipped the rest would split the company rather than merge it.
  for (const deal of moving) await authorizeLead(auth, deal);

  const store = getCrmOverlayStore();
  const linkedAt = new Date().toISOString();
  for (const deal of moving) {
    await store.linkDeal({
      dealId: deal.id,
      companyId: targetId,
      companyName: target.name,
      linkedById: auth.user.id,
      linkedByName: auth.user.name,
      linkedAt,
    });
  }

  return { sourceName: source.name, targetName: target.name, movedDealIds: moving.map((d) => d.id) };
}
