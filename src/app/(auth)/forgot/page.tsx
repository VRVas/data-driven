import type { Metadata } from "next";
import Link from "next/link";
import { AccountActionForm } from "@/components/AccountActionForm";
import { requestPasswordReset } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Reset your password - OOVIE" };

export default function ForgotPage() {
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight">Forgot your password?</h1>
      <p className="mt-1.5 mb-8 text-sm text-[var(--color-ink-muted)]">
        Enter your work email and we&apos;ll send a link to choose a new one.
      </p>
      <AccountActionForm
        action={requestPasswordReset}
        submit="Email me a reset link"
        pendingLabel="Sending…"
        fields={[
          { name: "email", label: "Work email", type: "email", autoComplete: "email", placeholder: "you@ooviestudios.com" },
        ]}
        footer={
          <>
            Remembered it?{" "}
            <Link href="/login" className="text-[var(--color-brand-bright)] hover:underline">
              Sign in
            </Link>
          </>
        }
      />
    </div>
  );
}
