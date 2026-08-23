import type { Brand } from "@/lib/types";
import { outcomeOf } from "@/lib/lifecycle";

/**
 * What is wrong with the pipeline RIGHT NOW.
 *
 * Distinct from data-quality.json, which is the ETL's cleaning log from the
 * original spreadsheet import - fourteen notes about 'N/A' in date columns,
 * correctly frozen because that is a record of what happened once. The screen
 * says so. The copilot's tool description did not, and neither did the system
 * prompt, so a frozen migration log was being reported as today's pipeline
 * health.
 *
 * The gap underneath that was the real one: nothing examined a lead created
 * after the import. The most broken record possible - a name and nothing else
 * - produced no finding anywhere, and the aggregate counts that did exist gave
 * a number without ever saying which records it meant.
 *
 * Pure and time-injectable, so "gone quiet" is testable rather than dependent
 * on the day the suite runs.
 */
export type HygienySeverity = "high" | "medium";

export interface HygieneFinding {
  id: string;
  name: string;
  /** Stable key, so a finding can be counted and filtered. */
  check: string;
  severity: HygienySeverity;
  /** What is wrong, in the user's terms. */
  detail: string;
}

export const STALE_DAYS = 90;

const daysBetween = (from: string, to: Date): number =>
  Math.floor((to.getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);

export function hygieneFindings(brands: Brand[], now: Date = new Date()): HygieneFinding[] {
  const out: HygieneFinding[] = [];
  const add = (b: Brand, check: string, severity: HygienySeverity, detail: string) =>
    out.push({ id: b.id, name: b.name, check, severity, detail });

  for (const b of brands) {
    const open = outcomeOf(b.status) === "open";

    if (b.scores?.budget == null) {
      // The only finding that stops a lead being ranked at all, so it outranks
      // everything else that might be missing from it.
      add(b, "no-value", "high", "No commercial value, so it scores zero on opportunity and cannot be ranked.");
    }
    if (!b.owner) add(b, "no-owner", "high", "Nobody owns it, so nobody is accountable for the next move.");
    if (!b.industry) add(b, "no-industry", "medium", "No industry, so it is absent from the segment scorecard and the whitespace map.");
    if (!b.status) add(b, "no-stage", "medium", "No stage, so it carries no win probability.");

    if (open) {
      if (!b.followUpDate) add(b, "no-follow-up", "medium", "No follow-up date, so it can never be late and will never appear in the work queue.");
      if (!b.waitingOn && !b.followUpDate) add(b, "untriaged", "medium", "Nobody has said who owes the next move.");
      if (b.lastContact && daysBetween(b.lastContact, now) > STALE_DAYS) {
        add(b, "gone-quiet", "medium", `No contact for ${daysBetween(b.lastContact, now)} days.`);
      }
      if (!b.lastContact) add(b, "never-contacted", "medium", "No last-contact date, so freshness cannot be judged.");
    } else if (b.followUpDate) {
      add(b, "finished-with-follow-up", "medium", "The deal is finished but still carries a follow-up date.");
    }

    if (b.initialContact && b.closingFailed && b.closingFailed < b.initialContact) {
      add(b, "impossible-dates", "high", "It closes before it opens, so its measured duration is meaningless.");
    }
  }

  // Highest severity first, then grouped by record so one lead reads as one
  // problem rather than as five scattered rows.
  const rank = (s: HygienySeverity) => (s === "high" ? 0 : 1);
  return out.sort((a, c) => rank(a.severity) - rank(c.severity) || a.name.localeCompare(c.name));
}

export interface HygieneSummary {
  total: number;
  high: number;
  leadsAffected: number;
  byCheck: Record<string, number>;
}

export function hygieneSummary(findings: HygieneFinding[]): HygieneSummary {
  const byCheck: Record<string, number> = {};
  for (const f of findings) byCheck[f.check] = (byCheck[f.check] ?? 0) + 1;
  return {
    total: findings.length,
    high: findings.filter((f) => f.severity === "high").length,
    leadsAffected: new Set(findings.map((f) => f.id)).size,
    byCheck,
  };
}
