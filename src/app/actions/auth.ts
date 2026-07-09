"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { getUserStore } from "@/lib/store/users";
import { hashPassword, signupSchema } from "@/lib/auth/password";

export type AuthState = { error?: string } | undefined;

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
    // A successful sign-in throws a redirect (not an AuthError) — rethrow it.
    if (error instanceof AuthError) return { error: "Invalid email or password." };
    throw error;
  }
}

/** Create an account, then sign in. */
export async function signupAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
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
    if (error instanceof AuthError) return { error: "Account created — please sign in." };
    throw error;
  }
}
