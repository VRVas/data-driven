import { expect, type APIRequestContext } from "@playwright/test";

/**
 * A planted cohort for cross-checking the model against the screens.
 *
 * Everything is created through the real tool routes, which is the same code
 * the chat and the forms reach, and everything is named ZZQA so teardown can
 * find it. Ids are name slugs, so the prefix survives into the id.
 *
 * The cohort is built in PAIRS that differ in exactly one thing. A number on a
 * screen tells you very little on its own; two leads identical but for their
 * confidence, or their last contact, or their stage, turn every assertion into
 * a controlled comparison with a predictable direction.
 */
export const QA = "ZZQA";
export const QA_ID = /^zzqa-/;

export interface ToolResult<T = Record<string, unknown>> {
  status: number;
  ok: boolean;
  data?: T;
  error?: string;
}

export async function tool<T = Record<string, unknown>>(
  request: APIRequestContext,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult<T>> {
  const res = await request.post(`/api/copilot/tools/${name}`, { data: args });
  const body = (await res.json()) as { ok: boolean; data?: T; error?: string };
  return { status: res.status(), ok: body.ok, data: body.data, error: body.error };
}

/** Throws with the tool name attached, so a failure says which call broke. */
export async function must<T = Record<string, unknown>>(
  request: APIRequestContext,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const r = await tool<T>(request, name, args);
  expect(r.ok, `${name} failed: ${r.error ?? "no reason given"}`).toBe(true);
  return r.data as T;
}

export function ymd(daysFromToday: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

export interface Planted {
  id: string;
  name: string;
}

export interface PlantSpec {
  label: string;
  industry?: string;
  status?: string;
  priority?: string;
  owner?: string;
  valueEur?: number;
  confidence?: "Estimated" | "Confirmed";
  strategicValue?: number;
  strategicReason?: string;
  initialContact?: string;
  lastContact?: string;
  followUpDate?: string;
  closingFailed?: string;
  expectedMonths?: number;
  notes?: string;
  waitingOn?: "us" | "them" | "nobody";
}

/**
 * Create one lead and bring it to the state described.
 *
 * Deliberately routed through the same separate tools a person would use -
 * create, then value, then dates, then judgement - rather than one god-call,
 * because that is the sequence being tested.
 */
export async function plant(request: APIRequestContext, spec: PlantSpec): Promise<Planted> {
  const name = `${QA} ${spec.label}`;
  const created = await must<{ id: string; name: string }>(request, "create_lead", {
    name,
    ...(spec.industry ? { industry: spec.industry } : {}),
    ...(spec.status ? { status: spec.status } : {}),
    ...(spec.priority ? { priority: spec.priority } : {}),
    ...(spec.owner ? { owner: spec.owner } : {}),
    ...(spec.valueEur != null ? { valueEur: spec.valueEur } : {}),
    ...(spec.notes ? { notes: spec.notes } : {}),
  });

  // Confidence is not a create_lead field: a value typed at creation is an
  // estimate by definition, and claiming otherwise is what set_budget is for.
  if (spec.valueEur != null && spec.confidence === "Confirmed") {
    await must(request, "set_budget", { id: created.id, valueEur: spec.valueEur, confidence: "Confirmed" });
  }

  const dates: Record<string, unknown> = {};
  if (spec.initialContact) dates.initialContact = spec.initialContact;
  if (spec.lastContact) dates.lastContact = spec.lastContact;
  if (spec.closingFailed) dates.closingFailed = spec.closingFailed;
  if (spec.expectedMonths != null) dates.expectedMonths = spec.expectedMonths;
  if (Object.keys(dates).length) await must(request, "update_lead", { id: created.id, ...dates });

  if (spec.followUpDate || spec.waitingOn) {
    await must(request, "set_next_move", {
      id: created.id,
      ...(spec.waitingOn ? { waitingOn: spec.waitingOn } : {}),
      ...(spec.followUpDate ? { followUpDate: spec.followUpDate } : {}),
    });
  }

  if (spec.strategicValue != null) {
    await must(request, "set_strategic_value", {
      id: created.id,
      value: spec.strategicValue,
      ...(spec.strategicReason ? { reason: spec.strategicReason } : {}),
    });
  }

  return { id: created.id, name };
}

/** Remove everything this run planted. Best effort: teardown is the backstop. */
export async function uproot(request: APIRequestContext, planted: Planted[]): Promise<void> {
  for (const p of planted) {
    await tool(request, "delete_lead", { id: p.id }).catch(() => undefined);
  }
}

/** Priority as the app computes it, straight from the model tool. */
export async function priorityOf(request: APIRequestContext, id: string) {
  const d = await must<{
    priorityScore: number | null;
    grade: string | null;
    quadrant: string | null;
    opportunity: { score: number; adjustedBudgetEur: number; moneyIndex: number; strategicIndex: number } | null;
    winnability: { score: number; stageProbability?: number; freshness?: number } | null;
  }>(request, "explain_score", { id });
  return d;
}
