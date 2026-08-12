"use client";

import { useActionState, useEffect, useState } from "react";
import { saveBrand, deleteBrand, type BrandActionState } from "@/app/actions/brands";
import { OverlayPortal } from "@/components/ui/OverlayPortal";
import { BRAND_STATUSES, PRIORITIES, INDUSTRIES } from "@/lib/vocab";
import type { Brand } from "@/lib/types";
import { STRATEGIC_REASONS } from "@/lib/priority";

/** Mounted only while open — remounting gives each session fresh action state. */
export function BrandEditor({ brand, onClose, canDelete = false }: { brand: Brand | null; onClose: () => void; canDelete?: boolean }) {
  const isNew = brand === null;
  const [state, action, pending] = useActionState<BrandActionState, FormData>(saveBrand, undefined);

  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <OverlayPortal>
    <div className="fixed inset-0 z-[100] flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative flex h-full w-full max-w-md flex-col border-l border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-2xl">
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
          <h2 className="font-display text-lg font-semibold">{isNew ? "New lead" : brand!.name}</h2>
          <button onClick={onClose} className="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]" aria-label="Close">✕</button>
        </header>

        <form action={action} className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {!isNew && <input type="hidden" name="id" value={brand!.id} />}

          <FormField label="Brand name" required>
            <input name="name" required defaultValue={brand?.name ?? ""} className="auth-input" placeholder="e.g. Alibaba" />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Status">
              <SelectField name="status" defaultValue={brand?.status ?? ""} options={BRAND_STATUSES} />
            </FormField>
            <FormField label="Priority">
              <SelectField name="priority" defaultValue={brand?.priority ?? ""} options={PRIORITIES} />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Industry">
              <SelectField name="industry" defaultValue={brand?.industry ?? ""} options={INDUSTRIES} />
            </FormField>
            <FormField label="Owner">
              <input name="owner" defaultValue={brand?.owner ?? ""} className="auth-input" />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Point of contact">
              <input name="poc" defaultValue={brand?.poc ?? ""} className="auth-input" />
            </FormField>
            <FormField label="Contact email">
              <input type="email" name="email" defaultValue={brand?.email ?? ""} className="auth-input" placeholder="name@brand.com" />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Initial contact">
              <input type="date" name="initialContact" defaultValue={brand?.initialContact ?? ""} className="auth-input" />
            </FormField>
            <FormField label="Last contact">
              <input type="date" name="lastContact" defaultValue={brand?.lastContact ?? ""} className="auth-input" />
            </FormField>
            <FormField label="Follow up">
              <input type="date" name="followUpDate" defaultValue={brand?.followUpDate ?? ""} className="auth-input" />
            </FormField>
            <FormField label="Closing / failed">
              <input type="date" name="closingFailed" defaultValue={brand?.closingFailed ?? ""} className="auth-input" />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Waiting on">
              <select name="waitingOn" defaultValue={brand?.waitingOn ?? ""} className="auth-input">
                <option value="">— not decided —</option>
                <option value="us">Us — we owe the next move</option>
                <option value="them">Them — we are waiting</option>
              </select>
            </FormField>
            <FormField label="Expected duration (months)">
              <input
                type="number"
                name="expectedMonths"
                min={0}
                max={60}
                step={0.5}
                defaultValue={brand?.expectedMonths ?? ""}
                placeholder="e.g. 8"
                className="auth-input"
              />
            </FormField>
          </div>

          <FormField label="Next step">
            <input
              name="nextStep"
              defaultValue={brand?.nextStep ?? ""}
              placeholder="Send revised quote / chase legal"
              className="auth-input"
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Strategic value">
              <select name="strategicValue" defaultValue={String(brand?.strategicValue ?? 0)} className="auth-input">
                <option value="0">0 — none beyond the invoice</option>
                <option value="1">1 — some</option>
                <option value="2">2 — significant</option>
                <option value="3">3 — flagship</option>
              </select>
            </FormField>
            <FormField label="Why strategic">
              <select name="strategicReason" defaultValue={brand?.strategicReason ?? ""} className="auth-input">
                <option value="">— none —</option>
                {STRATEGIC_REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </FormField>
          </div>

          <FormField label="Notes">
            <textarea name="notes" defaultValue={brand?.notes ?? ""} rows={4} className="auth-input resize-none" />
          </FormField>

          {state?.error && (
            <p className="rounded-lg border border-[color-mix(in_srgb,var(--color-rose)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-rose)_12%,transparent)] px-3 py-2 text-sm text-[var(--color-rose)]">
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-full bg-[var(--color-brand)] px-6 py-3 text-sm font-semibold text-white shadow-[var(--shadow-glow)] transition-transform hover:scale-[1.02] disabled:opacity-60"
          >
            {pending ? "Saving…" : isNew ? "Create lead" : "Save changes"}
          </button>
        </form>

        {!isNew && (
          <footer className="border-t border-[var(--color-border)] px-6 py-4">
            {canDelete ? (
              <DeleteControl id={brand!.id} onDeleted={onClose} />
            ) : (
              <p className="text-sm text-[var(--color-ink-faint)]">
                Deleting a lead is restricted to admins — ask an admin to remove it.
              </p>
            )}
          </footer>
        )}
      </div>
    </div>
    </OverlayPortal>
  );
}

function DeleteControl({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const [state, action, pending] = useActionState<BrandActionState, FormData>(deleteBrand, undefined);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (state?.ok) onDeleted();
  }, [state, onDeleted]);

  return (
    <form action={action} className="flex items-center justify-between">
      <input type="hidden" name="id" value={id} />
      <span className="text-sm text-[var(--color-ink-faint)]">
        {confirming ? "This can't be undone." : "Remove this lead"}
      </span>
      {confirming ? (
        <div className="flex gap-2">
          <button type="button" onClick={() => setConfirming(false)} className="rounded-full border border-[var(--color-border-strong)] px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button type="submit" disabled={pending} className="rounded-full bg-[var(--color-rose)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60">
            {pending ? "Deleting…" : "Delete"}
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="rounded-full border border-[color-mix(in_srgb,var(--color-rose)_40%,transparent)] px-3 py-1.5 text-sm text-[var(--color-rose)]">
          Delete
        </button>
      )}
    </form>
  );
}

function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
        {label}{required && <span className="text-[var(--color-rose)]"> *</span>}
      </span>
      {children}
    </label>
  );
}

function SelectField({ name, defaultValue, options }: { name: string; defaultValue: string; options: readonly string[] }) {
  return (
    <select name={name} defaultValue={defaultValue} className="auth-input">
      <option value="">—</option>
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}
