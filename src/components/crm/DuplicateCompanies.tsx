import Link from "next/link";
import { MergeCompanies } from "@/components/crm/MergeCompanies";
import type { Company } from "@/lib/crm/types";

/**
 * Possible duplicate clients, and the control that folds two into one.
 *
 * This lived on the companies page. That page is gone, and merging two records
 * that should be one is a data-quality job anyway, so it sits with the rest of
 * them now.
 *
 * The candidate list is deliberately over-inclusive: missing a real duplicate
 * costs more than dismissing a wrong guess, and nothing merges without someone
 * choosing to. `firstDealOf` maps a company to a lead so a suggested name is
 * still clickable now that companies have no page of their own.
 */
export function DuplicateCompanies({
  duplicates,
  mergeChoices,
  firstDealOf,
  canMerge,
}: {
  duplicates: Company[][];
  mergeChoices: { id: string; name: string; dealCount: number }[];
  firstDealOf: (companyId: string) => string | null;
  canMerge: boolean;
}) {
  return (
    <section className="glass p-4 sm:p-6">
      <h2 className="font-display text-xl font-semibold tracking-tight">
        {duplicates.length > 0 ? `${duplicates.length} possible duplicate clients` : "Merge clients"}
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-[var(--color-ink-muted)]">
        {duplicates.length > 0 ? (
          <>
            These names look alike, which is not the same as being the same client -
            &ldquo;Allianz Bank&rdquo; and &ldquo;Allianz CH&rdquo; may well be two customers. Nothing is ever
            merged automatically.
          </>
        ) : (
          <>
            Nothing looks duplicated right now. If two records are the same client anyway, fold one into the
            other here.
          </>
        )}
      </p>

      {duplicates.length > 0 && (
        <ul className="mt-4 space-y-2">
          {duplicates.map((group) => (
            <li
              key={group.map((c) => c.id).join("|")}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
            >
              {group.map((c, i) => {
                const dealId = firstDealOf(c.id);
                return (
                  <span key={c.id} className="flex items-center gap-2">
                    {i > 0 && <span className="text-[var(--color-ink-faint)]">-</span>}
                    {dealId ? (
                      <Link href={`/dashboard/pipeline/${dealId}`} className="hover:text-[var(--color-brand)]">
                        {c.name}
                      </Link>
                    ) : (
                      <span>{c.name}</span>
                    )}
                  </span>
                );
              })}
            </li>
          ))}
        </ul>
      )}

      {canMerge ? (
        <MergeCompanies companies={mergeChoices} />
      ) : (
        <p className="mt-3 text-sm text-[var(--color-ink-faint)]">
          Merging is restricted - ask an administrator if two of these are the same client.
        </p>
      )}
    </section>
  );
}
