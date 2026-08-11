"use client";

import { useActionState, useEffect, useState } from "react";
import { saveAgent, deleteAgent, type AgentActionState } from "@/app/actions/agents";
import { OverlayPortal } from "@/components/ui/OverlayPortal";
import { AGENT_STATUSES, PRIORITIES } from "@/lib/vocab";
import type { Agent } from "@/lib/types";

export function AgentEditor({ agent, onClose }: { agent: Agent | null; onClose: () => void }) {
  const isNew = agent === null;
  const [state, action, pending] = useActionState<AgentActionState, FormData>(saveAgent, undefined);

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
      <div className="relative flex h-full w-full max-w-md flex-col border-l border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-2xl">
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
          <h2 className="font-display text-lg font-semibold">{isNew ? "New agent / agency" : agent!.name}</h2>
          <button onClick={onClose} className="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]" aria-label="Close">✕</button>
        </header>

        <form action={action} className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {!isNew && <input type="hidden" name="id" value={agent!.id} />}

          <Field label="Name" required>
            <input name="name" required defaultValue={agent?.name ?? ""} className="auth-input" placeholder="e.g. PV Agency" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <SelectField name="status" defaultValue={agent?.status ?? ""} options={AGENT_STATUSES} />
            </Field>
            <Field label="Priority">
              <SelectField name="priority" defaultValue={agent?.priority ?? ""} options={PRIORITIES} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Owner">
              <input name="owner" defaultValue={agent?.owner ?? ""} className="auth-input" />
            </Field>
            <Field label="Point of contact">
              <input name="poc" defaultValue={agent?.poc ?? ""} className="auth-input" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Initial contact">
              <input type="date" name="initialContact" defaultValue={agent?.initialContact ?? ""} className="auth-input" />
            </Field>
            <Field label="Last contact">
              <input type="date" name="lastContact" defaultValue={agent?.lastContact ?? ""} className="auth-input" />
            </Field>
            <Field label="Follow up">
              <input type="date" name="followUp" defaultValue={agent?.followUp ?? ""} className="auth-input" />
            </Field>
          </div>

          <Field label="Notes">
            <textarea name="notes" defaultValue={agent?.notes ?? ""} rows={4} className="auth-input resize-none" />
          </Field>

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
            {pending ? "Saving…" : isNew ? "Create" : "Save changes"}
          </button>
        </form>

        {!isNew && (
          <footer className="border-t border-[var(--color-border)] px-6 py-4">
            <DeleteControl id={agent!.id} onDeleted={onClose} />
          </footer>
        )}
      </div>
    </div>
    </OverlayPortal>
  );
}

function DeleteControl({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const [state, action, pending] = useActionState<AgentActionState, FormData>(deleteAgent, undefined);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (state?.ok) onDeleted();
  }, [state, onDeleted]);

  return (
    <form action={action} className="flex items-center justify-between">
      <input type="hidden" name="id" value={id} />
      <span className="text-sm text-[var(--color-ink-faint)]">
        {confirming ? "This can't be undone." : "Remove this agent"}
      </span>
      {confirming ? (
        <div className="flex gap-2">
          <button type="button" onClick={() => setConfirming(false)} className="rounded-full border border-[var(--color-border-strong)] px-3 py-1.5 text-sm">Cancel</button>
          <button type="submit" disabled={pending} className="rounded-full bg-[var(--color-rose)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60">
            {pending ? "Deleting…" : "Delete"}
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="rounded-full border border-[color-mix(in_srgb,var(--color-rose)_40%,transparent)] px-3 py-1.5 text-sm text-[var(--color-rose)]">Delete</button>
      )}
    </form>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
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
