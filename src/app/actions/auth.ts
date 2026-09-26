"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { getUserStore } from "@/lib/store/users";
import { hashPassword, signupSchema } from "@/lib/auth/password";
import { z } from "zod";
import { getChallengeStore } from "@/lib/store/challenges";
import { generateOtp, generateResetToken, issueBlockedReason, otpLoginEnabled } from "@/lib/auth/challenge";
import { sendLoginCode, sendResetLink } from "@/lib/auth/notify";
import { recoveryState, withDataset } from "@/lib/recovery/control";

export type AuthState = { error?: string; notice?: string } | undefined;

/** Sign in with email + password. Redirects to /dashboard on success. */
export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/dashboard",
    });
    return undefined;
  } catch (error) {
    // A successful sign-in throws a redirect (not an AuthError) - rethrow it.
    if (error instanceof AuthError) return { error: "Invalid email or password." };
    throw error;
  }
}

/** Create an account, then sign in. */
export async function signupAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if ((await recoveryState()).mode !== "ready") return { error: "Initialize this environment in Data & Recovery first." };
  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check your details." };
  }

  const { name, email, password } = parsed.data;
  const store = getUserStore();

  if (await store.findByEmail(email)) {
    return { error: "An account with this email already exists." };
  }

  await store.create({ name, email, passwordHash: await hashPassword(password) });

  try {
    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
    return undefined;
  } catch (error) {
    if (error instanceof AuthError) return { error: "Account created - please sign in." };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Passwordless sign-in and password recovery
//
// Every one of these runs before a session exists, so none can be permission
// guarded. They are instead written so that an unauthenticated caller learns
// nothing: the reply is identical whether or not the address is registered.
// ---------------------------------------------------------------------------

const emailSchema = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email.") });

/** Same words either way - anything else turns this into an account oracle. */
const SENT = "If that address has an account, a message is on its way.";

/** Email a one-time sign-in code. */
export async function requestLoginCode(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if ((await recoveryState()).mode !== "ready") return { error: "Sign-in is paused during data recovery." };
  // Checked here as well as on the page: a hidden link is not an access control.
  if (!otpLoginEnabled()) return { error: "Signing in with a code isn't enabled here." };

  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { email } = parsed.data;

  const store = getChallengeStore();
  const blocked = issueBlockedReason(await store.recent(email, "otp"));
  // Rate limiting is reported plainly: it is true of any address, so it leaks
  // nothing, and silence here would just look broken.
  if (blocked) return { error: blocked };

  const user = await getUserStore().findByEmail(email);
  if (user && user.active !== false) {
    const code = generateOtp();
    await store.issue(email, "otp", code);
    await sendLoginCode(email, user.name, code);
  }
  // Redirects either way, so the next screen is not a tell about the account.
  redirect(`/login/code?email=${encodeURIComponent(email)}`);
}

/** Email a single-use password-reset link. */
export async function requestPasswordReset(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if ((await recoveryState()).mode !== "ready") return { error: "Password recovery is paused during data recovery." };
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { email } = parsed.data;

  return withDataset(async () => {
    const store = getChallengeStore();
    const blocked = issueBlockedReason(await store.recent(email, "reset"));
    if (blocked) return { error: blocked };

    const user = await getUserStore().findByEmail(email);
    if (user && user.active !== false) {
      const token = generateResetToken();
      await store.issue(email, "reset", token);
      const base = process.env.APP_URL?.replace(/\/$/, "") ?? "";
      const url = `${base}/reset?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
      await sendResetLink(email, user.name, url);
    }
    return { notice: SENT };
  }, true);
}

/** Consume a reset link and set a new password. */
export async function resetPassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if ((await recoveryState()).mode !== "ready") return { error: "Password recovery is paused during data recovery." };
  const parsed = z
    .object({
      email: z.string().trim().toLowerCase().email(),
      token: z.string().min(1),
      password: signupSchema.shape.password,
    })
    .safeParse({ email: formData.get("email"), token: formData.get("token"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check your details." };

  const { email, token, password } = parsed.data;
  const store = getChallengeStore();
  const result = await store.redeem(email, "reset", token);
  if (!result.ok) return { error: result.reason ?? "That link is no longer valid." };

  const user = await getUserStore().findByEmail(email);
  if (!user) return { error: "That link is no longer valid." };

  await getUserStore().setPasswordHash(user.id, await hashPassword(password));
  // A password change must kill every outstanding code and link, including any
  // the attacker may have triggered.
  await store.revokeAll(email);

  return { notice: "Password updated. You can sign in now." };
}
