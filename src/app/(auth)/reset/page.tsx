import type { Metadata } from "next";
import Link from "next/link";
import { AccountActionForm } from "@/components/AccountActionForm";
import { resetPassword } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Choose a new password · OOVIE" };

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; token?: string }>;
}) {
  const { email = "", token = "" } = await searchParams;

  if (!email || !token) {
    return (
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">That link is incomplete</h1>
        <p className="mt-1.5 mb-8 text-sm text-[var(--color-ink-muted)]">
          Open the link from your email, or{" "}
          <Link href="/forgot" className="text-[var(--color-brand-bright)] hover:underline">
            request a new one
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-1.5 mb-8 text-sm text-[var(--color-ink-muted)]">
        For {email}. This link works once.
      </p>
      <AccountActionForm
        action={resetPassword}
        submit="Save new password"
        pendingLabel="Saving…"
        hidden={{ email, token }}
        doneHref={{ href: "/login", label: "Sign in with your new password" }}
        fields={[
          {
            name: "password",
            label: "New password",
            type: "password",
            autoComplete: "new-password",
            placeholder: "At least 10 characters",
            minLength: 10,
          },
        ]}
      />
    </div>
  );
}
