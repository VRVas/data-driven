"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { AuthState } from "@/app/actions/auth";

interface Field {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  minLength?: number;
  inputMode?: "text" | "numeric";
  pattern?: string;
  defaultValue?: string;
}

interface Props {
  action: (prev: AuthState, formData: FormData) => Promise<AuthState>;
  fields: Field[];
  submit: string;
  pendingLabel?: string;
  hidden?: Record<string, string>;
  footer?: React.ReactNode;
  /** Shown instead of the form once the action reports success. */
  doneHref?: { href: string; label: string };
}

/** Shared shell for the recovery / passwordless forms. */
export function AccountActionForm({ action, fields, submit, pendingLabel, hidden, footer, doneHref }: Props) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(action, undefined);

  return (
    <form action={formAction} className="space-y-4">
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}

      {fields.map((f) => (
        <label key={f.name} className="block">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
            {f.label}
          </span>
          <input
            name={f.name}
            type={f.type ?? "text"}
            autoComplete={f.autoComplete}
            placeholder={f.placeholder}
            minLength={f.minLength}
            inputMode={f.inputMode}
            pattern={f.pattern}
            defaultValue={f.defaultValue}
            required
            className="auth-input"
          />
        </label>
      ))}

      {state?.error && (
        <p
          role="alert"
          className="rounded-lg border border-[color-mix(in_srgb,var(--color-rose)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-rose)_12%,transparent)] px-3 py-2 text-sm text-[var(--color-rose)]"
        >
          {state.error}
        </p>
      )}

      {state?.notice && (
        <p
          role="status"
          className="rounded-lg border border-[color-mix(in_srgb,var(--color-mint)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-mint)_12%,transparent)] px-3 py-2 text-sm text-[var(--color-mint)]"
        >
          {state.notice}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-[var(--color-brand)] px-6 py-3 text-sm font-semibold text-[var(--color-on-brand)] shadow-[var(--shadow-glow)] transition-transform hover:scale-[1.02] disabled:opacity-60"
      >
        {pending ? (pendingLabel ?? "Please wait…") : submit}
      </button>

      {state?.notice && doneHref && (
        <p className="text-center text-sm">
          <Link href={doneHref.href} className="text-[var(--color-brand-bright)] hover:underline">
            {doneHref.label}
          </Link>
        </p>
      )}

      {footer && <div className="text-center text-sm text-[var(--color-ink-muted)]">{footer}</div>}
    </form>
  );
}
