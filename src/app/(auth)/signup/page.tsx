import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { signupAction } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Create account · OOVIE" };

export default function SignupPage() {
  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1.5 mb-8 text-sm text-[var(--color-ink-muted)]">
        Join the OOVIE business-development workspace.
      </p>
      <AuthForm mode="signup" action={signupAction} />
    </div>
  );
}
