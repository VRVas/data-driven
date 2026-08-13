"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

/**
 * Code entry signs in on the client, because `signIn("otp")` has to set the
 * session cookie on a response the browser follows.
 */
export function LoginCodeForm({ email }: { email: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const code = String(new FormData(e.currentTarget).get("code") ?? "").trim();
        const res = await signIn("otp", { email, code, redirect: false });
        if (res?.ok) {
          router.push("/dashboard");
          router.refresh();
          return;
        }
        // The server deliberately does not say which of wrong / expired / used
        // it was, so neither does this.
        setError("That code is not valid. Check it, or request a new one.");
        setPending(false);
      }}
    >
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
          Six-digit code
        </span>
        <input
          name="code"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          autoComplete="one-time-code"
          required
          placeholder="000000"
          className="auth-input text-center font-mono text-lg tracking-[0.4em]"
        />
      </label>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-[color-mix(in_srgb,var(--color-rose)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-rose)_12%,transparent)] px-3 py-2 text-sm text-[var(--color-rose)]"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-[var(--color-brand)] px-6 py-3 text-sm font-semibold text-white shadow-[var(--shadow-glow)] transition-transform hover:scale-[1.02] disabled:opacity-60"
      >
        {pending ? "Checking…" : "Sign in"}
      </button>
    </form>
  );
}
