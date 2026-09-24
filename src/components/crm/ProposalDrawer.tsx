"use client";

import { useActionState, useEffect, useId, useState, type ReactNode } from "react";
import { deleteProposal, saveProposal, type CrmActionState } from "@/app/actions/crm";
import { OverlayPortal } from "@/components/ui/OverlayPortal";
import type { Proposal, ProposalStatus } from "@/lib/crm/types";

const STATUSES: readonly ProposalStatus[] = [
  "draft",
  "sent",
  "accepted",
  "rejected",
  "expired",
  "withdrawn",
];

/** `<input type="date">` only accepts yyyy-MM-dd; stamps are stored as full ISO. */
const dayValue = (v: string | null | undefined): string => (v ? v.slice(0, 10) : "");

export function ProposalDrawer({
  proposal,
  dealId,
  deals,
  onClose,
}: {
  proposal: Proposal | null;
  dealId: string;
  deals: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const isNew = proposal === null;
  const [state, action, pending] = useActionState<CrmActionState, FormData>(saveProposal, undefined);
  const titleId = useId();
  const currentDealId = proposal?.dealId ?? dealId;
  const pickDeal = isNew && deals.length > 1;

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
              <h2 id={titleId} className="truncate font-display text-lg font-semibold">
                {isNew ? "New proposal" : `Revision v${proposal.revision}`}
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
            {!isNew && <input type="hidden" name="id" value={proposal.id} />}
            {!pickDeal && <input type="hidden" name="dealId" value={currentDealId} />}

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
              {pickDeal && (
                <Field label="Deal" required>
                  <select name="dealId" defaultValue={currentDealId} className="auth-input">
                    {deals.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="Value (€)" required>
                  <input
                    type="number"
                    name="value"
                    required
                    min={0}
                    step={1}
                    inputMode="numeric"
                    defaultValue={proposal?.value ?? ""}
                    className="auth-input"
                    placeholder="25000"
                  />
                </Field>
                <Field label="Status" required>
                  <select name="status" defaultValue={proposal?.status ?? "draft"} className="auth-input">
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s[0].toUpperCase() + s.slice(1)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Sent" hint="Leave empty and it stamps itself when you mark it sent.">
                  <input type="date" name="sentAt" defaultValue={dayValue(proposal?.sentAt)} className="auth-input" />
                </Field>
                <Field label="Valid until">
                  <input
                    type="date"
                    name="validUntil"
                    defaultValue={dayValue(proposal?.validUntil)}
                    className="auth-input"
                  />
                </Field>
              </div>

              <Field label="Notes">
                <textarea
                  name="notes"
                  rows={4}
                  maxLength={500}
                  defaultValue={proposal?.notes ?? ""}
                  className="auth-input resize-none"
                  placeholder="Scope, discount, who signs it off…"
                />
              </Field>
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
                disabled={pending}
                className="w-full rounded-full bg-[var(--color-brand)] px-6 py-3 text-sm font-semibold text-[var(--color-on-brand)] shadow-[var(--shadow-glow)] transition-transform hover:scale-[1.02] disabled:opacity-60"
              >
                {pending ? "Saving…" : isNew ? "Add proposal" : "Save changes"}
              </button>
            </div>
          </form>

          {!isNew && (
            <footer className="border-t border-[var(--color-border)] px-5 py-4 sm:px-6">
              <DeleteControl id={proposal.id} onDeleted={onClose} />
            </footer>
          )}
        </div>
      </div>
    </OverlayPortal>
  );
}

function DeleteControl({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const [state, action, pending] = useActionState<CrmActionState, FormData>(deleteProposal, undefined);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (state?.ok) onDeleted();
  }, [state, onDeleted]);

  return (
    <form action={action} className="flex flex-wrap items-center justify-between gap-2">
      <input type="hidden" name="id" value={id} />
      <span className="text-sm text-[var(--color-ink-faint)]">
        {confirming ? "This revision goes for good." : "Remove this revision"}
      </span>
      {confirming ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-full border border-[var(--color-border-strong)] px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-full bg-[var(--color-rose)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? "Deleting…" : "Delete"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-full border border-[color-mix(in_srgb,var(--color-rose)_40%,transparent)] px-3 py-1.5 text-sm text-[var(--color-rose)]"
        >
          Delete
        </button>
      )}
    </form>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
        {label}
        {required && <span className="text-[var(--color-rose)]"> *</span>}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-[var(--color-ink-faint)]">{hint}</span>}
    </label>
  );
}
