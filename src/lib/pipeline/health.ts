import { outcomeOf } from "@/lib/lifecycle";
import { daysUntil } from "@/lib/time";
import { currentProposals } from "@/lib/crm/logic";
import type { Proposal } from "@/lib/crm/types";
import type { Brand, WaitingOn } from "@/lib/types";

/**
 * Pipeline health — who owes the next move, and are they late?
 *
 * The feedback asked two questions that look like one: "are we late with the
 * follow-up on their request?" and "are we late to remind them something?".
 * Both are answered by an overdue date, but they mean opposite things and
 * need opposite responses — one is our backlog, the other is a chase list.
 * Telling them apart needs a side, which is why `waitingOn` exists.
 *
 * Pure and time-injectable, so every branch below is testable.
 */

/** No contact for this long and a lead is drifting, whoever owes the move. */
export const STALE_DAYS = 90;

export type WaitingSource = "explicit" | "proposal" | "followUp" | "none";

export interface LeadHealth {
  waitingOn: WaitingOn | null;
  dueDate: string | null;
  /** Why we believe it, so the UI can distinguish a decision from a guess. */
  source: WaitingSource;
  /** Whole days past `dueDate`; 0 when not late. */
  daysLate: number;
  /** We owe them something and the date has passed. */
  lateOnUs: boolean;
  /** They owe us something and we have not chased since the date passed. */
  lateOnThem: boolean;
  /** Open, but nobody has said who owes the next move. */
  untriaged: boolean;
  daysSinceContact: number | null;
  stale: boolean;
}

/** A proposal sitting with the client is the clearest "waiting on them" there is. */
function awaitingDecision(proposals: Proposal[]): Proposal | null {
  return currentProposals(proposals).find((p) => p.status === "sent") ?? null;
}

/**
 * Who owes the next move.
 *
 * An explicit answer always wins. Otherwise a proposal out for decision means
 * the ball is with them; a follow-up date on its own means we said we would do
 * something. With neither, the lead is untriaged — reported as such rather
 * than quietly filed under one side.
 */
export function nextActionFor(
  brand: Pick<Brand, "waitingOn" | "followUpDate">,
  proposals: Proposal[] = [],
): { waitingOn: WaitingOn | null; dueDate: string | null; source: WaitingSource } {
  const sent = awaitingDecision(proposals);
  const dueDate = brand.followUpDate ?? sent?.validUntil ?? null;

  if (brand.waitingOn) return { waitingOn: brand.waitingOn, dueDate, source: "explicit" };
  if (sent) return { waitingOn: "them", dueDate, source: "proposal" };
  if (brand.followUpDate) return { waitingOn: "us", dueDate, source: "followUp" };
  return { waitingOn: null, dueDate: null, source: "none" };
}

export function healthOf(brand: Brand, proposals: Proposal[] = [], now: Date = new Date()): LeadHealth {
  const closed = outcomeOf(brand.status) !== "open";
  const { waitingOn, dueDate, source } = nextActionFor(brand, proposals);

  const contactDays = brand.lastContact ? daysUntil(brand.lastContact, now) : Number.NaN;
  const daysSinceContact = Number.isNaN(contactDays) ? null : -contactDays;

  const due = dueDate ? daysUntil(dueDate, now) : Number.NaN;
  const daysLate = !closed && !Number.isNaN(due) && due < 0 ? -due : 0;
  const late = daysLate > 0;

  return {
    waitingOn,
    dueDate,
    source,
    daysLate,
    // A finished deal owes nobody anything, so it can never be late or stale.
    lateOnUs: late && waitingOn === "us",
    lateOnThem: late && waitingOn === "them",
    untriaged: !closed && waitingOn === null,
    daysSinceContact,
    stale: !closed && daysSinceContact !== null && daysSinceContact > STALE_DAYS,
  };
}

export interface PipelineHealth {
  open: number;
  lateOnUs: number;
  lateOnThem: number;
  untriaged: number;
  stale: number;
  /** Value sent to clients with no answer yet — the "waiting for greenlight" figure. */
  awaitingGreenlightEur: number;
}

export interface LeadWithHealth {
  brand: Brand;
  health: LeadHealth;
}

export function withHealth(brands: Brand[], proposals: Proposal[] = [], now: Date = new Date()): LeadWithHealth[] {
  const byLead = new Map<string, Proposal[]>();
  for (const p of proposals) {
    const list = byLead.get(p.dealId);
    if (list) list.push(p);
    else byLead.set(p.dealId, [p]);
  }
  return brands.map((brand) => ({ brand, health: healthOf(brand, byLead.get(brand.id) ?? [], now) }));
}

export function pipelineHealth(
  brands: Brand[],
  proposals: Proposal[] = [],
  now: Date = new Date(),
): PipelineHealth {
  const rows = withHealth(brands, proposals, now);
  const open = rows.filter((r) => outcomeOf(r.brand.status) === "open");
  const openIds = new Set(open.map((r) => r.brand.id));

  return {
    open: open.length,
    lateOnUs: open.filter((r) => r.health.lateOnUs).length,
    lateOnThem: open.filter((r) => r.health.lateOnThem).length,
    untriaged: open.filter((r) => r.health.untriaged).length,
    stale: open.filter((r) => r.health.stale).length,
    // Only live deals: money quoted on a lead we already won or lost is history.
    awaitingGreenlightEur: currentProposals(proposals)
      .filter((p) => p.status === "sent" && openIds.has(p.dealId))
      .reduce((sum, p) => sum + p.value, 0),
  };
}

export const WAITING_LABEL: Record<WaitingOn, string> = {
  us: "On us",
  them: "On them",
};
