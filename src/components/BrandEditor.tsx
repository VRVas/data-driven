"use client";

import { useActionState, useEffect, useState } from "react";
import { saveBrand, deleteBrand, type BrandActionState } from "@/app/actions/brands";
import { OverlayPortal } from "@/components/ui/OverlayPortal";
import { BRAND_STATUSES, PRIORITIES, INDUSTRIES } from "@/lib/vocab";
import type { Brand } from "@/lib/types";
import { STRATEGIC_REASONS } from "@/lib/priority";
import { RUBRIC_FIELDS } from "@/lib/pipeline/rubric";
import { LEAD_FIELD_HELP } from "@/lib/leads/field-help";

/** Mounted only while open - remounting gives each session fresh action state. */
export function BrandEditor({
  brand,
  onClose,
  canDelete = false,
  company,
}: {
  brand: Brand | null;
  onClose: () => void;
  canDelete?: boolean;
  /** Set when the lead is being started from a company page. */
  company?: { id: string; name: string };
}) {
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
          <h2 className="font-display text-lg font-semibold">{isNew ? (company ? "New deal" : "New lead") : brand!.name}</h2>
          <button onClick={onClose} className="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]" aria-label="Close">✕</button>
        </header>

        <form action={action} className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {!isNew && <input type="hidden" name="id" value={brand!.id} />}
          {isNew && company && (
            <>
              <input type="hidden" name="companyId" value={company.id} />
              <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink-muted)]">
                New deal for <span className="text-[var(--color-ink)]">{company.name}</span>. It joins their
                existing work rather than starting a separate client.
              </p>
            </>
          )}

          <FormField label="Brand name" required help="name">
            <input name="name" required defaultValue={brand?.name ?? ""} className="auth-input" placeholder="e.g. Alibaba" />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Status" help="status">
              <SelectField name="status" defaultValue={brand?.status ?? ""} options={BRAND_STATUSES} />
            </FormField>
            <FormField label="Priority" help="priority">
              <SelectField name="priority" defaultValue={brand?.priority ?? ""} options={PRIORITIES} />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Industry" help="industry">
              <SelectField name="industry" defaultValue={brand?.industry ?? ""} options={INDUSTRIES} />
            </FormField>
            <FormField label="Owner" help="owner">
              <input name="owner" defaultValue={brand?.owner ?? ""} className="auth-input" />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Point of contact" help="poc">
              <input name="poc" defaultValue={brand?.poc ?? ""} className="auth-input" />
            </FormField>
            <FormField label="Contact email" help="email">
              <input type="email" name="email" defaultValue={brand?.email ?? ""} className="auth-input" placeholder="name@brand.com" />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Initial contact" help="initialContact">
              <input type="date" name="initialContact" defaultValue={brand?.initialContact ?? ""} className="auth-input" />
            </FormField>
            <FormField label="Last contact" help="lastContact">
              <input type="date" name="lastContact" defaultValue={brand?.lastContact ?? ""} className="auth-input" />
            </FormField>
            <FormField label="Follow up" help="followUpDate">
              <input type="date" name="followUpDate" defaultValue={brand?.followUpDate ?? ""} className="auth-input" />
            </FormField>
            <FormField label="Closing / failed" help="closingFailed">
              <input type="date" name="closingFailed" defaultValue={brand?.closingFailed ?? ""} className="auth-input" />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Waiting on" help="waitingOn">
              <select name="waitingOn" defaultValue={brand?.waitingOn ?? ""} className="auth-input">
                <option value="">- not decided -</option>
                <option value="us">Us - we owe the next move</option>
                <option value="them">Them - we are waiting</option>
              </select>
            </FormField>
            <FormField label="Expected duration (months)" help="expectedMonths">
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

          <FormField label="Next step" help="nextStep">
            <input
              name="nextStep"
              defaultValue={brand?.nextStep ?? ""}
              placeholder="Send revised quote / chase legal"
              className="auth-input"
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Commercial value (€)" help="budget">
              <input
                type="number"
                name="budget"
                min={0}
                step={500}
                defaultValue={brand?.scores?.budget ?? ""}
                placeholder="e.g. 45000"
                className="auth-input"
              />
            </FormField>
            <FormField label="Confidence" help="assumption">
              <SelectField
                name="assumption"
                defaultValue={brand?.scores?.assumption ?? ""}
                options={["Estimated", "Confirmed"]}
                placeholder="- estimated -"
              />
            </FormField>
          </div>
          <p className="-mt-2 text-xs text-[var(--color-ink-faint)]">
            A starting figure. Accepting a proposal replaces it and marks it confirmed.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Strategic value" help="strategicValue">
              <select name="strategicValue" defaultValue={String(brand?.strategicValue ?? 0)} className="auth-input">
                <option value="0">0 - none beyond the invoice</option>
                <option value="1">1 - some</option>
                <option value="2">2 - significant</option>
                <option value="3">3 - flagship</option>
              </select>
            </FormField>
            <FormField label="Why strategic" help="strategicReason">
              <select name="strategicReason" defaultValue={brand?.strategicReason ?? ""} className="auth-input">
                <option value="">- none -</option>
                {STRATEGIC_REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </FormField>
          </div>

          <fieldset className="rounded-xl border border-[var(--color-border)] p-3">
            <legend className="px-1 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
              Scoring (0-5)
            </legend>
            <p className="mb-3 text-xs text-[var(--color-ink-faint)]">
              Your judgement of the lead. Budget and pace are worked out from the fields above.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {RUBRIC_FIELDS.map(({ key, label }) => (
                <FormField key={key} label={label} help={key}>
                  <input
                    type="number"
                    name={key}
                    min={0}
                    max={5}
                    step={0.5}
                    defaultValue={brand?.scores?.[key] ?? ""}
                    className="auth-input"
                  />
                </FormField>
              ))}
            </div>
          </fieldset>

          <FormField label="Notes" help="notes">
            <textarea name="notes" defaultValue={brand?.notes ?? ""} rows={4} className="auth-input resize-none" />
            <span className="mt-1 block text-xs text-[var(--color-ink-faint)]">
              The standing summary of this lead. Saving REPLACES it - to add to the story without losing
              anyone else&rsquo;s, leave a comment on the lead instead.
            </span>
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
                Deleting a lead is restricted to admins - ask an admin to remove it.
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

function FormField({
  label,
  required,
  help,
  children,
}: {
  label: string;
  required?: boolean;
  /** Key into LEAD_FIELD_HELP - the field's own name. */
  help?: string;
  children: React.ReactNode;
}) {
  const info = help ? LEAD_FIELD_HELP[help] : undefined;
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      {/* The button sits outside the label: inside it, clicking would also
          activate the control the label is for. */}
      <label className="block">
        <span className="mb-1.5 block pr-6 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
          {label}{required && <span className="text-[var(--color-rose)]"> *</span>}
        </span>
        {children}
      </label>
      {info && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={`What ${label} is for`}
            title={`What ${label} is for`}
            className={`absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-semibold transition-colors ${
              open
                ? "border-[var(--color-brand)] text-[var(--color-brand-bright)]"
                : "border-[var(--color-border-strong)] text-[var(--color-ink-faint)] hover:border-[var(--color-brand)] hover:text-[var(--color-ink)]"
            }`}
          >
            i
          </button>
          {open && (
            <p className="mt-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2 text-xs leading-relaxed text-[var(--color-ink-muted)]">
              {info.what}
              {info.feeds && (
                <>
                  {" "}
                  <span className="text-[var(--color-ink)]">{info.feeds}</span>
                </>
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function SelectField({
  name,
  defaultValue,
  options,
  placeholder = "-",
}: {
  name: string;
  defaultValue: string;
  options: readonly string[];
  placeholder?: string;
}) {
  return (
    <select name={name} defaultValue={defaultValue} className="auth-input">
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}
