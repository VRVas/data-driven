import { describe, it, expect } from "vitest";
import { relativeTime, daysUntil } from "@/lib/time";

describe("relativeTime", () => {
  const now = new Date("2026-07-10T12:00:00").getTime();

  it("formats past durations", () => {
    expect(relativeTime(new Date(now - 30_000).toISOString(), now)).toBe("just now");
    expect(relativeTime(new Date(now - 2 * 3_600_000).toISOString(), now)).toBe("2 hours ago");
    expect(relativeTime(new Date(now - 3 * 86_400_000).toISOString(), now)).toBe("3 days ago");
  });

  it("formats future durations", () => {
    expect(relativeTime(new Date(now + 60 * 60_000).toISOString(), now)).toBe("in 1 hour");
    expect(relativeTime(new Date(now + 5 * 86_400_000).toISOString(), now)).toBe("in 5 days");
  });

  it("falls back to a date past a month", () => {
    expect(relativeTime("2026-01-01T00:00:00Z", now)).toBe("2026-01-01");
  });
});

describe("daysUntil", () => {
  const now = new Date("2026-07-10T12:00:00");

  it("computes whole-day deltas from today", () => {
    expect(daysUntil("2026-07-10", now)).toBe(0);
    expect(daysUntil("2026-07-13", now)).toBe(3);
    expect(daysUntil("2026-07-07", now)).toBe(-3);
  });

  it("returns NaN for malformed input", () => {
    expect(Number.isNaN(daysUntil("nope", now))).toBe(true);
  });
});
