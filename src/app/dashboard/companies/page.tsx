import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The companies list was retired: it showed the same book of business as the
 * pipeline, one level up. What it held that the pipeline did not now lives on
 * the lead page (the client relationship) or on Data Quality (merging
 * duplicates).
 *
 * A redirect rather than a deleted route, because this URL is in bookmarks and
 * in older copilot answers.
 */
export default function CompaniesPage() {
  redirect("/dashboard/pipeline");
}
