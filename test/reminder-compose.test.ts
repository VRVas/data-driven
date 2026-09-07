import { describe, it, expect } from "vitest";
import {
  composeReminderEmail,
  composeReminderNotification,
  composeReminderCancellation,
  leadSummaryLines,
  calendarUid,
  type ReminderContext,
  type ReminderLeadContext,
} from "@/lib/reminders/compose";
import type { Reminder } from "@/lib/store/reminders";

const reminder = (over: Partial<Reminder> = {}): Reminder => ({
  id: "rem-1",
  ownerId: "u1",
  ownerName: "Ada Lovelace",
  ownerEmail: "ada@oovie.dev",
  title: "Work on the Alleanza quote",
  topic: "Revised pricing after their feedback",
  notes: null,
  brandId: null,
  brandName: null,
  dueAt: "2026-09-01T09:00:00.000Z",
  channels: { inApp: true, email: true },
  holdMinutes: null,
  status: "scheduled",
  sequence: 0,
  sentAt: null,
  error: null,
  attempts: 0,
  createdById: "u1",
  createdByName: "Ada Lovelace",
  createdAt: "2026-08-23T10:00:00.000Z",
  updatedAt: "2026-08-23T10:00:00.000Z",
  ...over,
});

const lead = (over: Partial<ReminderLeadContext> = {}): ReminderLeadContext => ({
  id: "alleanza",
  name: "Alleanza",
  status: "Advanced",
  priority: "High",
  owner: "Ada",
  poc: "Marco Rossi",
  email: "marco@alleanza.example",
  industry: "Finance",
  valueEur: 52_000,
  valueBasis: "accepted",
  priorityScore: 72,
  grade: "A",
  quadrant: "Pursue",
  waitingOn: "us",
  waitingInferred: false,
  daysLate: 4,
  nextStep: "Send the revised quote",
  lastContact: "2026-08-01",
  followUpDate: "2026-08-19",
  notes: "They asked for a phased rollout.",
  recentComments: [],
  company: { name: "Alleanza Group", openPipelineEur: 130_000, lifetimeEur: 52_000, dealCount: 3 },
  latestProposal: { valueEur: 52_000, status: "accepted", sentAt: "2026-07-20T00:00:00.000Z" },
  ...over,
});

const ctx = (over: Partial<ReminderContext> = {}): ReminderContext => ({
  reminder: reminder(),
  lead: null,
  appUrl: "https://bd.example",
  senderAddress: "DoNotReply@example.azurecomm.net",
  ...over,
});

const unfold = (s: string) => s.replace(/\r\n /g, "");
const icsOf = (attachments: { contentInBase64: string }[]) =>
  unfold(Buffer.from(attachments[0].contentInBase64, "base64").toString("utf8"));

describe("leadSummaryLines", () => {
  it("pulls the CRM detail somebody would otherwise open the app for", () => {
    const lines = leadSummaryLines(lead()).join("\n");
    expect(lines).toContain("Stage: Advanced");
    expect(lines).toContain("Owner: Ada");
    expect(lines).toContain("Contact: Marco Rossi, marco@alleanza.example");
    expect(lines).toContain("EUR 52,000 (accepted)");
    expect(lines).toContain("priority 72, grade A, Pursue");
    expect(lines).toContain("Latest proposal: EUR 52,000 - accepted");
    expect(lines).toContain("Alleanza Group - 3 deals");
  });

  it("says who owes the move, and whether anybody actually said so", () => {
    expect(leadSummaryLines(lead()).join("\n")).toContain("Next move owed by: us, 4 days late");
    expect(leadSummaryLines(lead({ waitingInferred: true })).join("\n")).toContain("(inferred, not stated)");
    expect(leadSummaryLines(lead({ waitingOn: null, daysLate: 0 })).join("\n")).toContain("nobody has said");
  });

  it("leaves out what it does not know rather than guessing", () => {
    const bare = leadSummaryLines(
      lead({ owner: null, poc: null, email: null, notes: null, latestProposal: null, company: null }),
    ).join("\n");
    expect(bare).not.toContain("Owner:");
    expect(bare).not.toContain("Contact:");
    expect(bare).not.toContain("Latest proposal:");
    expect(bare).not.toContain("null");
  });

  it("names a missing value as the reason the lead cannot rank", () => {
    expect(leadSummaryLines(lead({ valueEur: null, valueBasis: null })).join("\n"))
      .toContain("not set - this lead cannot be ranked");
  });

  it("carries the discussion, attributed and dated, not just the summary", () => {
    const out = leadSummaryLines(
      lead({
        recentComments: [
          { author: "Giulia", at: "2026-08-20T09:00:00.000Z", body: "They want phased pricing." },
          { author: "Marco", at: "2026-08-12T09:00:00.000Z", body: "Procurement is the blocker." },
        ],
      }),
    ).join("\n");
    expect(out).toContain("Comment (Giulia, 2026-08-20): They want phased pricing.");
    expect(out).toContain("Comment (Marco, 2026-08-12): Procurement is the blocker.");
  });

  it("keeps a long comment on one line, because the email is read on a phone", () => {
    const out = leadSummaryLines(
      lead({
        recentComments: [
          { author: "Ada", at: "2026-08-20T09:00:00.000Z", body: `first\n\nsecond ${"x".repeat(400)}` },
        ],
      }),
    );
    const comment = out.find((l) => l.startsWith("Comment ("))!;
    expect(comment).not.toContain("\n");
    expect(comment).toContain("first second");
    expect(comment.endsWith("...")).toBe(true);
  });

  it("shows only the newest three, so the email stays a reminder", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      author: "Ada",
      at: "2026-08-20T09:00:00.000Z",
      body: `comment ${i}`,
    }));
    const out = leadSummaryLines(lead({ recentComments: many }));
    expect(out.filter((l) => l.startsWith("Comment ("))).toHaveLength(3);
  });
});

describe("composeReminderEmail", () => {
  it("leads with the reminder, then the evidence", () => {
    const mail = composeReminderEmail(ctx());
    expect(mail.subject).toBe("Reminder: Work on the Alleanza quote");
    expect(mail.body.startsWith("Reminder: Work on the Alleanza quote")).toBe(true);
    expect(mail.body).toContain("About: Revised pricing after their feedback");
    expect(mail.body).toContain("Set by Ada Lovelace.");
  });

  it("names the lead in the subject when there is one", () => {
    const mail = composeReminderEmail(ctx({ lead: lead() }));
    expect(mail.subject).toBe("Reminder: Work on the Alleanza quote (Alleanza)");
    expect(mail.body).toContain("--- From the CRM ---");
    expect(mail.body).toContain("https://bd.example/dashboard/pipeline/alleanza");
  });

  it("still reads sensibly for a reminder with no lead at all", () => {
    const mail = composeReminderEmail(ctx());
    expect(mail.body).not.toContain("From the CRM");
    expect(mail.body).toContain("https://bd.example/dashboard/reminders");
    expect(mail.attachments).toHaveLength(0);
  });

  it("omits links when the app does not know its own address", () => {
    expect(composeReminderEmail(ctx({ appUrl: null })).body).not.toContain("http");
  });

  it("attaches a calendar hold only when one was asked for", () => {
    expect(composeReminderEmail(ctx()).attachments).toHaveLength(0);

    const held = composeReminderEmail(ctx({ reminder: reminder({ holdMinutes: 30 }) }));
    expect(held.attachments).toHaveLength(1);
    expect(held.attachments[0].contentType).toBe("text/calendar");
    expect(held.body).toContain("30 minutes is attached");
  });

  it("blocks exactly the time asked for, at the time it is due", () => {
    const ics = icsOf(composeReminderEmail(ctx({ reminder: reminder({ holdMinutes: 15 }) })).attachments);
    expect(ics).toContain("DTSTART:20260901T090000Z");
    expect(ics).toContain("DTEND:20260901T091500Z");
    expect(ics).toContain("X-MICROSOFT-CDO-BUSYSTATUS:BUSY");
  });

  it("puts the CRM detail in the calendar entry too", () => {
    const ics = icsOf(
      composeReminderEmail(ctx({ reminder: reminder({ holdMinutes: 30 }), lead: lead() })).attachments,
    );
    expect(ics).toContain("DESCRIPTION:");
    expect(ics).toContain("Stage: Advanced");
  });

  it("addresses the invitation from the sender to the owner", () => {
    const ics = icsOf(composeReminderEmail(ctx({ reminder: reminder({ holdMinutes: 30 }) })).attachments);
    expect(ics).toContain("mailto:DoNotReply@example.azurecomm.net");
    expect(ics).toContain("mailto:ada@oovie.dev");
  });
});

describe("composeReminderCancellation", () => {
  it("gives the held time back", () => {
    const mail = composeReminderCancellation(ctx({ reminder: reminder({ holdMinutes: 30, sequence: 1 }) }));
    const ics = icsOf(mail.attachments);
    expect(mail.subject).toBe("Cancelled: Work on the Alleanza quote");
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("X-MICROSOFT-CDO-BUSYSTATUS:FREE");
  });

  it("uses the same uid, one sequence higher, or the client ignores it", () => {
    const r = reminder({ holdMinutes: 30, sequence: 2 });
    const ics = icsOf(composeReminderCancellation(ctx({ reminder: r })).attachments);
    expect(ics).toContain(`UID:${calendarUid(r.id)}`);
    expect(ics).toContain("SEQUENCE:3");
  });
});

describe("composeReminderNotification", () => {
  it("is short, and points at the lead it concerns", () => {
    const note = composeReminderNotification(ctx({ lead: lead() }));
    expect(note.title).toBe("Work on the Alleanza quote");
    expect(note.body).toContain("Alleanza - Advanced");
    expect(note.href).toBe("/dashboard/pipeline/alleanza");
  });

  it("falls back to the reminders screen with no lead", () => {
    expect(composeReminderNotification(ctx()).href).toBe("/dashboard/reminders");
  });

  it("says so plainly when there is nothing else to say", () => {
    const bare = composeReminderNotification(ctx({ reminder: reminder({ topic: null, notes: null }) }));
    expect(bare.body).toBe("No further detail was recorded.");
  });
});
