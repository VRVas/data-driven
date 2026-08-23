import { NextResponse } from "next/server";
import { dispatchDueReminders } from "@/lib/reminders/dispatch";

/**
 * Deliver whatever reminders are due.
 *
 * Meant for a scheduler - an Azure Container Apps job, a Logic App, a cron -
 * calling it every minute or so. Dispatching is idempotent by claim, so
 * calling it twice in the same second is harmless and calling it late only
 * makes reminders late, never lost.
 *
 * Guarded by a shared secret rather than a session, because the caller is a
 * machine. Without the secret configured the route refuses outright: an open
 * endpoint that sends email is a spam relay, and defaulting to "allow" is how
 * that happens by accident.
 */
export const dynamic = "force-dynamic";

function authorised(req: Request): boolean {
  const expected = process.env.REMINDER_DISPATCH_KEY?.trim();
  if (!expected) return false;

  const header = req.headers.get("x-dispatch-key")?.trim();
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const supplied = header || bearer;
  if (!supplied || supplied.length !== expected.length) return false;

  // Constant-time: a length-safe compare stops the key being guessed a
  // character at a time from response timings.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  try {
    const summary = await dispatchDueReminders();
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "dispatch failed" },
      { status: 500 },
    );
  }
}
