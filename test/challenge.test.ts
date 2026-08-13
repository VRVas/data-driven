import { describe, it, expect, afterEach } from "vitest";
import {
  MAX_ATTEMPTS,
  MAX_PER_HOUR,
  OTP_TTL_MINUTES,
  RESEND_COOLDOWN_SECONDS,
  RESET_TTL_MINUTES,
  expiryFor,
  generateOtp,
  generateResetToken,
  isExpired,
  isUsable,
  otpLoginEnabled,
  issueBlockedReason,
  safeEqual,
  type Challenge,
} from "@/lib/auth/challenge";

/**
 * A six-digit code is only a million wide. Everything that makes it safe is in
 * these rules, so each one is pinned: lose any of them quietly and the login
 * still works while being brute-forceable.
 */

const at = (iso: string): Challenge => ({
  id: "c",
  email: "a@b.c",
  kind: "otp",
  secretHash: "x",
  createdAt: iso,
  expiresAt: expiryFor("otp", new Date(iso)),
  attempts: 0,
  consumedAt: null,
});

describe("code generation", () => {
  it("is always six digits, zero padded", () => {
    for (let i = 0; i < 500; i++) expect(generateOtp()).toMatch(/^\d{6}$/);
  });

  it("covers the low end of the range rather than skipping it", () => {
    // A naive 100000 + random(900000) can never emit a leading zero, which
    // silently removes a tenth of the space.
    const many = Array.from({ length: 4000 }, generateOtp);
    expect(many.some((c) => c.startsWith("0"))).toBe(true);
  });

  it("does not repeat itself in any practical way", () => {
    const many = new Set(Array.from({ length: 2000 }, generateOtp));
    expect(many.size).toBeGreaterThan(1900);
  });

  it("gives reset tokens real entropy, not six digits", () => {
    const t = generateResetToken();
    expect(t.length).toBeGreaterThanOrEqual(43);
    expect(t).not.toMatch(/^\d+$/);
    expect(new Set(Array.from({ length: 200 }, generateResetToken)).size).toBe(200);
  });
});

describe("lifetime", () => {
  it("expires a login code quickly and a reset link less so", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(Date.parse(expiryFor("otp", now)) - now.getTime()).toBe(OTP_TTL_MINUTES * 60_000);
    expect(Date.parse(expiryFor("reset", now)) - now.getTime()).toBe(RESET_TTL_MINUTES * 60_000);
    expect(RESET_TTL_MINUTES).toBeGreaterThan(OTP_TTL_MINUTES);
  });

  it("treats the expiry instant as already expired", () => {
    const c = at("2026-01-01T00:00:00.000Z");
    expect(isExpired(c, new Date(Date.parse(c.expiresAt) - 1))).toBe(false);
    expect(isExpired(c, new Date(Date.parse(c.expiresAt)))).toBe(true);
  });
});

describe("usability", () => {
  const base = at("2026-01-01T00:00:00.000Z");
  const now = new Date("2026-01-01T00:01:00.000Z");

  it("accepts a fresh, unused code", () => {
    expect(isUsable(base, now)).toBe(true);
  });

  it("refuses one already consumed, so a code works exactly once", () => {
    expect(isUsable({ ...base, consumedAt: now.toISOString() }, now)).toBe(false);
  });

  it("refuses once the attempt budget is spent", () => {
    expect(isUsable({ ...base, attempts: MAX_ATTEMPTS - 1 }, now)).toBe(true);
    expect(isUsable({ ...base, attempts: MAX_ATTEMPTS }, now)).toBe(false);
  });

  it("refuses an expired one however few attempts were used", () => {
    expect(isUsable(base, new Date(Date.parse(base.expiresAt) + 1))).toBe(false);
  });

  it("keeps the guess budget far below the code space", () => {
    // 5 guesses against 10^6 is a 1-in-200,000 shot per issued code.
    expect(MAX_ATTEMPTS).toBeLessThanOrEqual(10);
  });
});

describe("issuing limits", () => {
  const now = new Date("2026-01-01T12:00:00.000Z");
  const madeAt = (secondsAgo: number) => at(new Date(now.getTime() - secondsAgo * 1000).toISOString());

  it("allows the first request", () => {
    expect(issueBlockedReason([], now)).toBeNull();
  });

  it("holds off a rapid resend, so nobody's inbox becomes a weapon", () => {
    expect(issueBlockedReason([madeAt(5)], now)).toMatch(/wait/i);
  });

  it("allows a resend once the cooldown passes", () => {
    expect(issueBlockedReason([madeAt(RESEND_COOLDOWN_SECONDS + 1)], now)).toBeNull();
  });

  it("caps the hourly total even when each is spaced out", () => {
    const spread = Array.from({ length: MAX_PER_HOUR }, (_, i) => madeAt(120 * (i + 1)));
    expect(issueBlockedReason(spread, now)).toMatch(/too many/i);
  });

  it("forgets requests older than the hour", () => {
    const old = Array.from({ length: MAX_PER_HOUR }, () => madeAt(3_601));
    expect(issueBlockedReason(old, now)).toBeNull();
  });

  it("stays under the Azure managed-domain ceiling of 10 mails an hour", () => {
    // Managed domains cap sending at 10/hour per SUBSCRIPTION, shared with
    // outreach, and the limit cannot be raised. One address must not eat it.
    expect(MAX_PER_HOUR).toBeLessThanOrEqual(5);
  });
});

describe("safeEqual", () => {
  it("matches identical strings and rejects everything else", () => {
    expect(safeEqual("abc123", "abc123")).toBe(true);
    expect(safeEqual("abc123", "abc124")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("login-by-code is opt-in", () => {
  const reset = () => delete process.env.OTP_LOGIN_ENABLED;
  afterEach(reset);

  it("is off when nothing is configured", () => {
    reset();
    // The whole safety argument rests on this: a managed mail domain allows 10
    // sends an hour for the entire subscription, and sign-in would eat it.
    expect(otpLoginEnabled()).toBe(false);
  });

  it("needs the exact string true, not merely a truthy value", () => {
    for (const v of ["1", "yes", "TRUE", "on", ""]) {
      process.env.OTP_LOGIN_ENABLED = v;
      expect(otpLoginEnabled()).toBe(false);
    }
    process.env.OTP_LOGIN_ENABLED = "true";
    expect(otpLoginEnabled()).toBe(true);
  });
});
