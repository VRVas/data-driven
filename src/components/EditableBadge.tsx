"use client";

import { useActionState, useEffect, useRef } from "react";
import { changeBrandStatus, setBrandField, type BrandActionState } from "@/app/actions/brands";

/**
 * A badge you can change without opening anything.
 *
 * The lead page used to carry a separate "Pipeline stage" panel below the
 * headline metrics, which meant the stage was written in two places on the same
 * screen: once as a badge under the name, once as a control further down. The
 * badge is now the control.
 *
 * It is a native select behind a styled pill rather than a custom popover. That
 * buys keyboard support, the platform picker on touch, and correct behaviour
 * when the list is longer than the space below it - none of which a hand-rolled
 * dropdown gets for free.
 */
export function EditableBadge({
  brandId,
  field,
  current,
  options,
  color,
  label,
  placeholder = "Not set",
}: {
  brandId: string;
  /** `status` routes through the transition graph; the rest are plain writes. */
  field: "status" | "priority" | "industry";
  current: string | null;
  /** What this badge can become, excluding the current value. */
  options: readonly string[];
  color?: string;
  label: string;
  placeholder?: string;
}) {
  const [state, action, pending] = useActionState<BrandActionState, FormData>(
    field === "status" ? changeBrandStatus : setBrandField,
    undefined,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // A rejected change leaves the select showing the value the server refused.
  useEffect(() => {
    if (state?.error) formRef.current?.reset();
  }, [state?.error]);

  const choices = [...(current ? [current] : []), ...options.filter((o) => o !== current)];

  return (
    <span className="inline-flex flex-col">
      <form ref={formRef} action={action} className="contents">
        <input type="hidden" name="id" value={brandId} />
        {field !== "status" && <input type="hidden" name="field" value={field} />}
        <span
          className="relative inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium transition-opacity focus-within:ring-2 focus-within:ring-[var(--color-brand)]/40"
          style={
            color
              ? {
                  color,
                  borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
                  background: `color-mix(in srgb, ${color} 12%, transparent)`,
                  opacity: pending ? 0.6 : 1,
                }
              : { opacity: pending ? 0.6 : 1 }
          }
        >
          {color && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden />}
          <select
            name={field === "status" ? "status" : "value"}
            aria-label={label}
            defaultValue={current ?? ""}
            disabled={pending || choices.length === 0}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="cursor-pointer appearance-none bg-transparent pr-3.5 text-xs font-medium text-current outline-none disabled:cursor-default"
          >
            {!current && <option value="">{placeholder}</option>}
            {choices.map((o) => (
              <option key={o} value={o} className="bg-[var(--color-bg-elevated)] text-[var(--color-ink)]">
                {o}
              </option>
            ))}
          </select>
          <svg
            className="pointer-events-none absolute right-2 h-2.5 w-2.5 opacity-60"
            viewBox="0 0 10 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden
          >
            <path d="M1 1l4 4 4-4" />
          </svg>
        </span>
      </form>
      {state?.error && (
        <span role="alert" className="mt-1 text-[11px] text-[var(--color-rose)]">
          {state.error}
        </span>
      )}
    </span>
  );
}
