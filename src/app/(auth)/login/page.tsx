import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { loginAction } from "@/app/actions/auth";
import { otpLoginEnabled } from "@/lib/auth/challenge";

export const metadata: Metadata = { title: "Sign in · OOVIE" };

export default function LoginPage() {
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1.5 mb-8 text-sm text-[var(--color-ink-muted)]">
        Sign in to your OOVIE workspace.
      </p>
      <AuthForm mode="login" action={loginAction} showCodeLogin={otpLoginEnabled()} />
    </div>
  );
}
