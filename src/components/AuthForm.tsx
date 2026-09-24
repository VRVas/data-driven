"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { AuthState } from "@/app/actions/auth";

interface Props {
  mode: "login" | "signup";
  action: (prev: AuthState, formData: FormData) => Promise<AuthState>;
  /** Login-by-code is off unless a custom mail domain is configured. */
  showCodeLogin?: boolean;
}

export function AuthForm({ mode, action, showCodeLogin = false }: Props) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(action, undefined);
  const isSignup = mode === "signup";

  return (
    <form action={formAction} className="space-y-4">
      {isSignup && (
        <Field label="Name">
          <input
            name="name"
            type="text"
            autoComplete="name"
            required
            className="auth-input"
            placeholder="Riccardo Acciarino"
          />
        </Field>
      )}

      <Field label="Work email">
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="auth-input"
          placeholder="you@ooviestudios.com"
        />
      </Field>

      <Field label="Password">
        <input
          name="password"
          type="password"
          autoComplete={isSignup ? "new-password" : "current-password"}
          required
          minLength={isSignup ? 10 : undefined}
          className="auth-input"
          placeholder={isSignup ? "At least 10 characters" : "••••••••"}
        />
      </Field>

      {!isSignup && (
        <p className="-mt-1 flex justify-between text-xs">
          {showCodeLogin ? (
            <Link href="/login/code" className="text-[var(--color-brand-bright)] hover:underline">
              Email me a code instead
            </Link>
          ) : (
            <span />
          )}
          <Link href="/forgot" className="text-[var(--color-ink-muted)] hover:underline">
            Forgot password?
          </Link>
        </p>
      )}

      {state?.error && (
        <p className="rounded-lg border border-[color-mix(in_srgb,var(--color-rose)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-rose)_12%,transparent)] px-3 py-2 text-sm text-[var(--color-rose)]">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-[var(--color-brand)] px-6 py-3 text-sm font-semibold text-[var(--color-on-brand)] shadow-[var(--shadow-glow)] transition-transform hover:scale-[1.02] disabled:opacity-60"
      >
        {pending ? "Please wait…" : isSignup ? "Create account" : "Sign in"}
      </button>

      <p className="text-center text-sm text-[var(--color-ink-muted)]">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="text-[var(--color-brand-bright)] hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New to OOVIE?{" "}
            <Link href="/signup" className="text-[var(--color-brand-bright)] hover:underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
        {label}
      </span>
      {children}
    </label>
  );
}
