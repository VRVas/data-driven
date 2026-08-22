"use client";

import { useActionState } from "react";
import { resolveOutcomeConflict, type BrandActionState } from "@/app/actions/brands";

/** Closes an imported-outcome conflict by accepting the stage a human already set. */
export function ResolveConflictButton({ id, status }: { id: string; status: string }) {
  const [state, action, pending] = useActionState<BrandActionState, FormData>(
    resolveOutcomeConflict,
    undefined,
  );

  return (
    <form action={action} className="ml-auto flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      {state?.error && <span className="text-xs text-[var(--color-rose)]">{state.error}</span>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-[var(--color-border-strong)] px-2.5 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-ink)] disabled:opacity-60"
      >
        {pending ? "Saving…" : `“${status}” is right`}
      </button>
    </form>
  );
}
