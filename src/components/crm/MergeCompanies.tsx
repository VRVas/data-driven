"use client";

import { useActionState, useState } from "react";
import { mergeCompanies, type CrmActionState } from "@/app/actions/crm";

export interface MergeChoice {
  id: string;
  name: string;
  dealCount: number;
}

/**
 * Fold one company into another.
 *
 * Deliberately two explicit pickers rather than a per-row "merge this":
 * merging is only ever right when someone has looked at both records, and the
 * survivor has to be a choice, not whichever row the button happened to be on.
 */
export function MergeCompanies({ companies }: { companies: MergeChoice[] }) {
  const [state, action, pending] = useActionState<CrmActionState, FormData>(mergeCompanies, undefined);
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");

  const source = companies.find((c) => c.id === sourceId);
  const target = companies.find((c) => c.id === targetId);
  const sameCompany = sourceId !== "" && sourceId === targetId;
  const ready = !!source && !!target && !sameCompany;

  return (
    <form action={action} className="mt-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-end">
        <label className="block">
          <span className="eyebrow mb-1.5 block">Merge this</span>
          <select
            name="sourceId"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            className="auth-input"
          >
            <option value="">— pick a company —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.dealCount})
              </option>
            ))}
          </select>
        </label>

        <span className="hidden pb-3 text-sm text-[var(--color-ink-faint)] sm:block">into</span>

        <label className="block">
          <span className="eyebrow mb-1.5 block">Keeping this one</span>
          <select
            name="targetId"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="auth-input"
          >
            <option value="">— pick a company —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.dealCount})
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          disabled={!ready || pending}
          className="rounded-full bg-[var(--color-brand)] px-5 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.02] disabled:opacity-40 disabled:hover:scale-100"
        >
          {pending ? "Merging…" : "Merge"}
        </button>
      </div>

      {sameCompany && (
        <p className="text-sm text-[var(--color-ink-muted)]">Pick two different companies.</p>
      )}

      {ready && (
        <p className="text-sm text-[var(--color-ink-muted)]">
          {source!.dealCount} {source!.dealCount === 1 ? "deal" : "deals"} will move to{" "}
          <span className="text-[var(--color-ink)]">{target!.name}</span>, and{" "}
          <span className="text-[var(--color-ink)]">{source!.name}</span> will no longer appear. Undo it by
          unlinking a deal from its lead page.
        </p>
      )}

      {state?.error && (
        <p role="alert" className="text-sm text-[var(--color-rose)]">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="text-sm text-[var(--color-mint)]">
          Merged.
        </p>
      )}
    </form>
  );
}
