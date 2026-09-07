import { notFound, redirect } from "next/navigation";
import { getCompanyDetail } from "@/lib/crm/graph";
import { dealValue } from "@/lib/crm/logic";
import { can } from "@/lib/auth/authorize";
import type { Deal } from "@/lib/crm/types";

export const dynamic = "force-dynamic";

const OUTCOME_ORDER: Record<Deal["outcome"], number> = { open: 0, won: 1, lost: 2 };

/**
 * Company detail merged into the lead page.
 *
 * Clicking a client on the companies list and clicking the same client in the
 * pipeline used to land on two different screens showing overlapping facts.
 * There is one screen now. This route stays as a redirect because the copilot's
 * company cards link to it and people have it bookmarked.
 *
 * It lands on the deal a user is most likely to have meant: open before
 * finished, then the largest.
 */
export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await can("lead:read"))) redirect("/dashboard");

  const detail = await getCompanyDetail(id);
  if (!detail) notFound();

  const [first] = [...detail.deals].sort(
    (a, b) =>
      OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome] ||
      (b.wonValue ?? dealValue(b, detail.proposals).value) -
        (a.wonValue ?? dealValue(a, detail.proposals).value),
  );
  // A company with no deals has nothing to show and no lead to show it on.
  if (!first) redirect("/dashboard/pipeline");
  redirect(`/dashboard/pipeline/${first.id}`);
}
