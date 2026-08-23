import { buildIcs, icsAttachment, type CalendarMethod } from "@/lib/mail/calendar";
import type { EmailAttachment } from "@/lib/mail/provider";
import type { Reminder } from "@/lib/store/reminders";

/**
 * What a reminder email says.
 *
 * Pure, and deliberately so: "comprehensively pulled from the CRM" is a
 * promise about content, and content assembled inside a send call is content
 * nobody ever reads until it is already in somebody's inbox.
 *
 * Every field is optional because a reminder does not need a lead. One about a
 * topic with no CRM record still has to produce a sensible message rather than
 * a page of "unknown".
 */

export interface ReminderLeadContext {
  id: string;
  name: string;
  status: string | null;
  priority: string | null;
  owner: string | null;
  poc: string | null;
  email: string | null;
  industry: string | null;
  valueEur: number | null;
  /** accepted / quoted / estimate / none - where the figure came from. */
  valueBasis: string | null;
  priorityScore: number | null;
  grade: string | null;
  quadrant: string | null;
  waitingOn: "us" | "them" | null;
  waitingInferred: boolean;
  daysLate: number;
  nextStep: string | null;
  lastContact: string | null;
  followUpDate: string | null;
  notes: string | null;
  /** Newest first. The discussion, which the single notes field cannot hold. */
  recentComments: { author: string; at: string; body: string }[];
  company: { name: string; openPipelineEur: number; lifetimeEur: number; dealCount: number } | null;
  latestProposal: { valueEur: number; status: string; sentAt: string | null } | null;
}

export interface ReminderContext {
  reminder: Reminder;
  lead: ReminderLeadContext | null;
  /** Base URL for deep links. Omitted when the app does not know its own address. */
  appUrl: string | null;
  senderAddress: string;
}

const eur = (n: number): string => `EUR ${Math.round(n).toLocaleString("en-GB")}`;

const line = (label: string, value: string | null | undefined): string | null =>
  value == null || value === "" ? null : `${label}: ${value}`;

/** The CRM detail, as plain lines. Anything unknown is left out, not guessed. */
export function leadSummaryLines(lead: ReminderLeadContext): string[] {
  const waiting =
    lead.waitingOn == null
      ? "nobody has said"
      : `${lead.waitingOn === "us" ? "us" : "them"}${lead.waitingInferred ? " (inferred, not stated)" : ""}${
          lead.daysLate > 0 ? `, ${lead.daysLate} days late` : ""
        }`;

  return [
    line("Lead", lead.name),
    line("Stage", lead.status),
    line("Priority label", lead.priority),
    line("Owner", lead.owner),
    line("Contact", [lead.poc, lead.email].filter(Boolean).join(", ") || null),
    line("Industry", lead.industry),
    lead.valueEur == null
      ? line("Value", "not set - this lead cannot be ranked until it has one")
      : line("Value", `${eur(lead.valueEur)}${lead.valueBasis ? ` (${lead.valueBasis})` : ""}`),
    lead.priorityScore == null
      ? null
      : line(
          "Score",
          `priority ${lead.priorityScore}${lead.grade ? `, grade ${lead.grade}` : ""}${
            lead.quadrant ? `, ${lead.quadrant}` : ""
          }`,
        ),
    line("Next move owed by", waiting),
    line("Next step", lead.nextStep),
    line("Last contact", lead.lastContact),
    line("Follow-up due", lead.followUpDate),
    lead.latestProposal
      ? line(
          "Latest proposal",
          `${eur(lead.latestProposal.valueEur)} - ${lead.latestProposal.status}${
            lead.latestProposal.sentAt ? `, sent ${lead.latestProposal.sentAt.slice(0, 10)}` : ""
          }`,
        )
      : null,
    lead.company
      ? line(
          "Client",
          `${lead.company.name} - ${lead.company.dealCount} ${
            lead.company.dealCount === 1 ? "deal" : "deals"
          }, ${eur(lead.company.openPipelineEur)} open, ${eur(lead.company.lifetimeEur)} lifetime`,
        )
      : null,
    line("Notes", lead.notes),
    // Trimmed and flattened: an email is read on a phone, and a comment with
    // its own paragraphs would break the label/value shape of every line here.
    ...(lead.recentComments ?? []).slice(0, 3).map((c) =>
      line(
        `Comment (${c.author}, ${c.at.slice(0, 10)})`,
        c.body.replace(/\s+/g, " ").slice(0, 280) + (c.body.length > 280 ? "..." : ""),
      ),
    ),
  ].filter((l): l is string => l !== null);
}

export interface ComposedReminder {
  subject: string;
  body: string;
  attachments: EmailAttachment[];
}

/** The calendar UID for a reminder. Stable, so a re-send updates one entry. */
export const calendarUid = (reminderId: string): string => `reminder-${reminderId}@oovie-bd`;

export function composeReminderEmail(ctx: ReminderContext, method: CalendarMethod = "REQUEST"): ComposedReminder {
  const { reminder, lead, appUrl } = ctx;

  const parts: string[] = [`Reminder: ${reminder.title}`, ""];
  if (reminder.topic) parts.push(`About: ${reminder.topic}`, "");
  if (reminder.notes) parts.push(reminder.notes, "");

  if (lead) {
    parts.push("--- From the CRM ---", ...leadSummaryLines(lead), "");
    if (appUrl) parts.push(`Open the lead: ${appUrl}/dashboard/pipeline/${lead.id}`, "");
  } else if (appUrl) {
    parts.push(`Open the app: ${appUrl}/dashboard/reminders`, "");
  }

  if (reminder.holdMinutes) {
    parts.push(
      `A calendar invitation for ${reminder.holdMinutes} minutes is attached, so the time is held rather than merely noted.`,
      "",
    );
  }

  parts.push(`Set by ${reminder.createdByName}.`);

  const attachments: EmailAttachment[] = reminder.holdMinutes
    ? [
        icsAttachment(
          {
            uid: calendarUid(reminder.id),
            start: new Date(reminder.dueAt),
            minutes: reminder.holdMinutes,
            summary: reminder.title,
            description: [reminder.topic, reminder.notes, lead ? leadSummaryLines(lead).join("\n") : null]
              .filter(Boolean)
              .join("\n\n"),
            organizer: { name: "OOVIE BD Intelligence", email: ctx.senderAddress },
            attendee: { name: reminder.ownerName, email: reminder.ownerEmail },
            method,
            sequence: reminder.sequence,
            url: appUrl && lead ? `${appUrl}/dashboard/pipeline/${lead.id}` : undefined,
          },
          "reminder.ics",
        ),
      ]
    : [];

  return {
    subject: lead ? `Reminder: ${reminder.title} (${lead.name})` : `Reminder: ${reminder.title}`,
    body: parts.join("\n").trimEnd(),
    attachments,
  };
}

/** The short form for the in-app notification, which has no room for the CRM dump. */
export function composeReminderNotification(ctx: ReminderContext): { title: string; body: string; href: string | null } {
  const { reminder, lead } = ctx;
  const bits = [reminder.topic, lead ? `${lead.name}${lead.status ? ` - ${lead.status}` : ""}` : null, reminder.notes]
    .filter(Boolean)
    .join(" - ");

  return {
    title: reminder.title,
    body: bits || "No further detail was recorded.",
    href: lead ? `/dashboard/pipeline/${lead.id}` : "/dashboard/reminders",
  };
}

/** A withdrawal for a cancelled reminder that had already blocked time. */
export function composeReminderCancellation(ctx: ReminderContext): ComposedReminder {
  const { reminder, senderAddress } = ctx;
  return {
    subject: `Cancelled: ${reminder.title}`,
    body: [
      `The reminder "${reminder.title}" has been cancelled${reminder.topic ? ` (${reminder.topic})` : ""}.`,
      "",
      "The time held in your calendar is released.",
      `Cancelled by ${reminder.createdByName}.`,
    ].join("\n"),
    attachments: [
      icsAttachment(
        {
          uid: calendarUid(reminder.id),
          start: new Date(reminder.dueAt),
          minutes: reminder.holdMinutes ?? 15,
          summary: reminder.title,
          organizer: { name: "OOVIE BD Intelligence", email: senderAddress },
          attendee: { name: reminder.ownerName, email: reminder.ownerEmail },
          method: "CANCEL",
          // Higher than the invitation it withdraws, or clients ignore it.
          sequence: reminder.sequence + 1,
        },
        "cancel.ics",
      ),
    ],
  };
}

/** Exposed for tests that want the raw calendar rather than the attachment. */
export const reminderIcs = (ctx: ReminderContext, method: CalendarMethod = "REQUEST"): string =>
  buildIcs({
    uid: calendarUid(ctx.reminder.id),
    start: new Date(ctx.reminder.dueAt),
    minutes: ctx.reminder.holdMinutes ?? 15,
    summary: ctx.reminder.title,
    organizer: { email: ctx.senderAddress },
    attendee: { email: ctx.reminder.ownerEmail },
    method,
    sequence: ctx.reminder.sequence,
  });
