"use client";

import { useActionState, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { linkDealToCompany, unlinkDeal, type CrmActionState } from "@/app/actions/crm";
import { OverlayPortal } from "@/components/ui/OverlayPortal";

export interface LinkableCompany {
  id: string;
  name: string;
  dealCount: number;
}

export function LinkCompanyDrawer({
  deal,
  companies,
  onClose,
}: {
  deal: { id: string; name: string; companyId: string; isLinked: boolean };
  companies: LinkableCompany[];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<CrmActionState, FormData>(linkDealToCompany, undefined);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const titleId = useId();

  // Comes from the stored links rather than the shape of the company id.
  const linkedElsewhere = deal.isLinked;

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return companies
      .filter((c) => c.id !== deal.companyId)
      .filter((c) => (q ? c.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [companies, deal.companyId, query]);

  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <OverlayPortal>
      <div className="fixed inset-0 z-[100] flex justify-end">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="relative flex h-full w-full max-w-md flex-col border-l border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-2xl"
        >
          <header className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <div className="eyebrow mb-1">Company</div>
              <h2 id={titleId} className="truncate font-display text-lg font-semibold">
                Link {deal.name}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              aria-label="Close"
            >
              ✕
            </button>
          </header>

          <form action={action} className="flex min-h-0 flex-1 flex-col">
            <input type="hidden" name="dealId" value={deal.id} />

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
              <p className="text-sm text-[var(--color-ink-muted)]">
                This deal will be counted under the company you pick - which is how repeat business is tracked.
              </p>

              <Labelled label="Find a company">
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="auth-input"
                  placeholder="Search by name"
                />
              </Labelled>

              <fieldset className="min-w-0">
                <legend className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
                  Companies
                </legend>
                {options.length === 0 ? (
                  <p className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 text-sm text-[var(--color-ink-faint)]">
                    No other company matches that.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {options.map((c) => (
                      <label
                        key={c.id}
                        className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm ${
                          selected === c.id
                            ? "border-[var(--color-brand)] bg-[color-mix(in_srgb,var(--color-brand)_10%,transparent)]"
                            : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <input
                            type="radio"
                            name="companyId"
                            value={c.id}
                            checked={selected === c.id}
                            onChange={() => setSelected(c.id)}
                            className="accent-[var(--color-brand)]"
                          />
                          <span className="truncate">{c.name}</span>
                        </span>
                        <span className="shrink-0 text-xs text-[var(--color-ink-faint)]">
                          {c.dealCount} {c.dealCount === 1 ? "deal" : "deals"}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
            </div>

            <div className="space-y-3 border-t border-[var(--color-border)] px-5 py-4 sm:px-6">
              {state?.error && (
                <p
                  role="alert"
                  className="rounded-lg border border-[color-mix(in_srgb,var(--color-rose)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-rose)_12%,transparent)] px-3 py-2 text-sm text-[var(--color-rose)]"
                >
                  {state.error}
                </p>
              )}
              <button
                type="submit"
                disabled={pending || !selected}
                className="w-full rounded-full bg-[var(--color-brand)] px-6 py-3 text-sm font-semibold text-white shadow-[var(--shadow-glow)] transition-transform hover:scale-[1.02] disabled:opacity-60"
              >
                {pending ? "Linking…" : "Link to company"}
              </button>
            </div>
          </form>

          {linkedElsewhere && (
            <footer className="border-t border-[var(--color-border)] px-5 py-4 sm:px-6">
              <UnlinkControl dealId={deal.id} onUnlinked={onClose} />
            </footer>
          )}
        </div>
      </div>
    </OverlayPortal>
  );
}

function UnlinkControl({ dealId, onUnlinked }: { dealId: string; onUnlinked: () => void }) {
  const [state, action, pending] = useActionState<CrmActionState, FormData>(unlinkDeal, undefined);

  useEffect(() => {
    if (state?.ok) onUnlinked();
  }, [state, onUnlinked]);

  return (
    <form action={action} className="flex flex-wrap items-center justify-between gap-2">
      <input type="hidden" name="dealId" value={dealId} />
      <span className="text-sm text-[var(--color-ink-faint)]">Linked by hand - it can stand on its own again.</span>
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-[var(--color-border-strong)] px-3 py-1.5 text-sm hover:border-[var(--color-brand)] disabled:opacity-60"
      >
        {pending ? "Unlinking…" : "Unlink"}
      </button>
      {state?.error && (
        <p role="alert" className="w-full text-sm text-[var(--color-rose)]">
          {state.error}
        </p>
      )}
    </form>
  );
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
        {label}
      </span>
      {children}
    </label>
  );
}
