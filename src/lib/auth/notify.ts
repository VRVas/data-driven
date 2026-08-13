import "server-only";
import { getEmailProvider, isAcsConfigured } from "@/lib/mail/provider";
import { OTP_TTL_MINUTES, RESET_TTL_MINUTES } from "@/lib/auth/challenge";

/**
 * Delivery for the two account emails.
 *
 * Without ACS configured there is nowhere to send, so the value is written to
 * the server log instead and the flow stays usable locally. That is a
 * development affordance and is refused outright in production, where a
 * silently-logged login code would be a credential in plaintext.
 */

function devDeliver(label: string, to: string, value: string): void {
  if (process.env.NODE_ENV === "production") return;
  console.info(`\n  [dev] ${label} for ${to}: ${value}\n  (no ACS configured — set ACS_ENDPOINT + ACS_SENDER_ADDRESS to send real mail)\n`);
}

export interface DeliveryResult {
  ok: boolean;
  /** True when nothing was emailed and the value went to the server log. */
  devOnly?: boolean;
  error?: string;
}

export async function sendLoginCode(to: string, name: string, code: string): Promise<DeliveryResult> {
  if (!isAcsConfigured()) {
    devDeliver("Login code", to, code);
    return { ok: process.env.NODE_ENV !== "production", devOnly: true, error: process.env.NODE_ENV === "production" ? "Email is not configured." : undefined };
  }
  const res = await getEmailProvider().send({
    to,
    toName: name,
    subject: `${code} is your BD Intelligence sign-in code`,
    body: [
      `Hi ${name || "there"},`,
      "",
      `Your sign-in code is ${code}`,
      "",
      `It expires in ${OTP_TTL_MINUTES} minutes and can be used once.`,
      "If you did not ask to sign in, you can ignore this — nobody can get in without the code.",
    ].join("\n"),
  });
  return { ok: res.ok, error: res.error };
}

export async function sendResetLink(to: string, name: string, url: string): Promise<DeliveryResult> {
  if (!isAcsConfigured()) {
    devDeliver("Password reset link", to, url);
    return { ok: process.env.NODE_ENV !== "production", devOnly: true, error: process.env.NODE_ENV === "production" ? "Email is not configured." : undefined };
  }
  const res = await getEmailProvider().send({
    to,
    toName: name,
    subject: "Reset your BD Intelligence password",
    body: [
      `Hi ${name || "there"},`,
      "",
      "Use this link to choose a new password:",
      url,
      "",
      `The link expires in ${RESET_TTL_MINUTES} minutes and works once.`,
      "If you did not ask for this, ignore it — your password has not changed.",
    ].join("\n"),
  });
  return { ok: res.ok, error: res.error };
}
