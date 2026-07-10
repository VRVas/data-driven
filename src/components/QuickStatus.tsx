"use client";

import { useActionState } from "react";
import { changeBrandStatus, type BrandActionState } from "@/app/actions/brands";
import { Badge } from "@/components/Badge";
import { STATUS_TOKEN } from "@/lib/scoring";
import type { BrandStatus } from "@/lib/types";

/** Current stage + one-click advance to any allowed next stage. */
export function QuickStatus({
  brandId,
  current,
  allowed,
}: {
  brandId: string;
  current: BrandStatus | null;
  allowed: BrandStatus[];
}) {
  const [state, action, pending] = useActionState<BrandActionState, FormData>(changeBrandStatus, undefined);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {current ? (
          <Badge color={STATUS_TOKEN[current]}>{current}</Badge>
        ) : (
          <span className="text-sm text-[var(--color-ink-faint)]">No stage yet</span>
        )}
        {allowed.length > 0 && (
          <span className="mx-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
            advance
          </span>
        )}
        {allowed.map((s) => (
          <form key={s} action={action} className="contents">
            <input type="hidden" name="id" value={brandId} />
            <input type="hidden" name="status" value={s} />
            <button
              type="submit"
              disabled={pending}
              className="rounded-full border border-[var(--color-border-strong)] px-2.5 py-1 text-xs text-[var(--color-ink-muted)] transition-colors duration-200 hover:border-[var(--color-frosted-canvas)] hover:text-[var(--color-ink)] disabled:opacity-50"
            >
              → {s}
            </button>
          </form>
        ))}
      </div>
      {state?.error && <p className="mt-2 text-xs text-[var(--color-rose)]">{state.error}</p>}
    </div>
  );
}
