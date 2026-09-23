import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { signupAction } from "@/app/actions/auth";
import { recoveryState } from "@/lib/recovery/control";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Create account - OOVIE" };

export default async function SignupPage() {
  if ((await recoveryState()).mode !== "ready") redirect("/recovery");
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
