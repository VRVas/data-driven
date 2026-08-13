import "server-only";
import { randomInt, randomBytes, timingSafeEqual } from "node:crypto";
import { hashPassword, verifyPassword } from "./password";

/**
 * One-time credentials: login codes and password-reset links.
 *
 * Both are "prove you can read this mailbox", so they share a shape and the
 * same rules. The rules are the security: a six-digit code is only 10^6 wide,
 * so it is safe only because it dies quickly, is single-use, and stops
 * accepting guesses long before the space can be walked.
 */

export type ChallengeKind = "otp" | "reset";

export interface Challenge {
  id: string;
  email: string;
  kind: ChallengeKind;
  /** bcrypt of the code/token — never the value itself. */
  secretHash: string;
  createdAt: string;
  expiresAt: string;
  attempts: number;
  consumedAt: string | null;
}

/** Short, because a login code is used within a minute or abandoned. */
export const OTP_TTL_MINUTES = 10;
/** Longer: people open password-reset mail on another device. */
export const RESET_TTL_MINUTES = 30;

/** Guesses allowed before the challenge is burned. */
export const MAX_ATTEMPTS = 5;

/** Per-address issuing limits, so nobody's inbox becomes a weapon. */
export const RESEND_COOLDOWN_SECONDS = 60;
export const MAX_PER_HOUR = 5;

/**
 * Login-by-code is OFF unless explicitly enabled.
 *
 * Not timidity: an Azure Managed Domain is capped at 10 sends per hour for the
 * whole subscription, and signing in is the highest-frequency mail an app
 * sends. Left on by default it would burn the quota that password reset and
 * outreach also draw from, and the 11th person to log in would simply be
 * stuck. Turn it on once a custom, DNS-verified domain is attached.
 */
export function otpLoginEnabled(): boolean {
  // Case-insensitive because Bicep's string(true) is "True": a strict === "true"
  // meant the switch could be set and still never turn on. Still only the word
  // itself, so "1"/"yes"/"on" do not enable it by accident.
  return process.env.OTP_LOGIN_ENABLED?.trim().toLowerCase() === "true";
}

export const ttlMinutesFor = (kind: ChallengeKind) => (kind === "otp" ? OTP_TTL_MINUTES : RESET_TTL_MINUTES);

/**
 * Six digits, uniformly distributed, from the CSPRNG. `Math.random` is
 * predictable from a few outputs, which for a login code means forgeable.
 */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Reset links live in URLs and mailboxes, so they get real entropy. */
export function generateResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export const generateSecret = (kind: ChallengeKind) => (kind === "otp" ? generateOtp() : generateResetToken());

export const hashSecret = (secret: string) => hashPassword(secret);

export function expiryFor(kind: ChallengeKind, now: Date = new Date()): string {
  return new Date(now.getTime() + ttlMinutesFor(kind) * 60_000).toISOString();
}

export const isExpired = (c: Pick<Challenge, "expiresAt">, now: Date = new Date()) => Date.parse(c.expiresAt) <= now.getTime();

export const isUsable = (c: Challenge, now: Date = new Date()) =>
  !c.consumedAt && c.attempts < MAX_ATTEMPTS && !isExpired(c, now);

/**
 * Why a new challenge may not be issued yet. Returns null when it may.
 * Counting issued-not-consumed keeps a resend loop from mailbombing someone
 * who never asked, and keeps us under the ACS send quota.
 */
export function issueBlockedReason(recent: Challenge[], now: Date = new Date()): string | null {
  const lastAt = recent.reduce((max, c) => Math.max(max, Date.parse(c.createdAt)), 0);
  if (lastAt && now.getTime() - lastAt < RESEND_COOLDOWN_SECONDS * 1000) {
    const wait = Math.ceil((RESEND_COOLDOWN_SECONDS * 1000 - (now.getTime() - lastAt)) / 1000);
    return `Wait ${wait}s before requesting another code.`;
  }
  const hourAgo = now.getTime() - 3_600_000;
  if (recent.filter((c) => Date.parse(c.createdAt) > hourAgo).length >= MAX_PER_HOUR) {
    return "Too many requests. Try again in an hour.";
  }
  return null;
}

/**
 * bcrypt compares in constant time already; this covers the cheap pre-check
 * so a wrong-length guess cannot be distinguished by timing either.
 */
export async function secretMatches(supplied: string, hash: string): Promise<boolean> {
  if (!supplied || !hash) return false;
  return verifyPassword(supplied, hash);
}

/** Constant-time string compare for values we hold in memory on both sides. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}
