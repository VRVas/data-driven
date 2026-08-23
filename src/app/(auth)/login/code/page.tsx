import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccountActionForm } from "@/components/AccountActionForm";
import { LoginCodeForm } from "@/components/LoginCodeForm";
import { requestLoginCode } from "@/app/actions/auth";
import { otpLoginEnabled } from "@/lib/auth/challenge";

export const metadata: Metadata = { title: "Sign in with a code - OOVIE" };

export default async function LoginCodePage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  if (!otpLoginEnabled()) notFound();
  const { email = "" } = await searchParams;

  if (email) {
    return (
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Check your email</h1>
        <p className="mt-1.5 mb-8 text-sm text-[var(--color-ink-muted)]">
          If {email} has an account, a six-digit code is on its way. It expires in 10 minutes.
        </p>
        <LoginCodeForm email={email} />
        <p className="mt-6 text-center text-sm text-[var(--color-ink-muted)]">
          <Link href="/login/code" className="text-[var(--color-brand-bright)] hover:underline">
            Use a different address
          </Link>
          {" - "}
          <Link href="/login" className="text-[var(--color-brand-bright)] hover:underline">
            Use a password
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight">Sign in with a code</h1>
      <p className="mt-1.5 mb-8 text-sm text-[var(--color-ink-muted)]">
        No password needed - we&apos;ll email you a six-digit code.
      </p>
      <AccountActionForm
        action={requestLoginCode}
        submit="Email me a code"
        pendingLabel="Sending…"
        fields={[
          { name: "email", label: "Work email", type: "email", autoComplete: "email", placeholder: "you@ooviestudios.com" },
        ]}
        footer={
          <>
            Prefer a password?{" "}
            <Link href="/login" className="text-[var(--color-brand-bright)] hover:underline">
              Sign in
            </Link>
          </>
        }
      />
    </div>
  );
}
