/**
 * iCalendar (.ics) generation - RFC 5545.
 *
 * Attaching one of these to an email is the whole mechanism for putting time in
 * somebody's calendar: no link, no meeting service, no integration. The parts
 * that decide whether it actually works:
 *
 *  - METHOD. `REQUEST` makes it an invitation the client offers to accept;
 *    `PUBLISH` makes it an "add to calendar" file; `CANCEL` withdraws one.
 *  - UID. Stable per reminder, so re-sending UPDATES the event instead of
 *    creating a second one. A changed event must also raise SEQUENCE, or most
 *    clients ignore the update as a duplicate.
 *  - TRANSP:OPAQUE, plus Outlook's X-MICROSOFT-CDO-BUSYSTATUS. Without them the
 *    entry can land as free time, which defeats the point of blocking it.
 *  - CRLF line endings and folding at 75 octets. Strict parsers reject long
 *    lines, and a description carrying CRM detail is easily over.
 */

export type CalendarMethod = "REQUEST" | "PUBLISH" | "CANCEL";

export interface CalendarEvent {
  uid: string;
  start: Date;
  minutes: number;
  summary: string;
  description?: string;
  organizer: { name?: string; email: string };
  attendee?: { name?: string; email: string };
  method?: CalendarMethod;
  /** Raise on every re-send of the same UID, or clients treat it as a duplicate. */
  sequence?: number;
  url?: string;
}

/** UTC basic format: 20260823T140000Z. */
export function icsStamp(d: Date): string {
  return `${d.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

/**
 * Escape per RFC 5545 section 3.3.11. Backslash first, or it re-escapes the
 * escapes it just wrote.
 */
export function icsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Fold to 75 octets, continuing with a leading space.
 *
 * Counted in UTF-8 bytes rather than characters: a line of accented text can be
 * inside the character limit and outside the octet limit.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    // Continuation lines carry a leading space, so they hold one octet less.
    if (bytes + size > (out.length === 0 ? 75 : 74)) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  if (current) out.push(current);
  return out.join("\r\n ");
}

const person = (p: { name?: string; email: string }): string =>
  p.name ? `CN=${icsText(p.name)}:mailto:${p.email}` : `:mailto:${p.email}`;

/** A single-event calendar, ready to attach as text/calendar. */
export function buildIcs(event: CalendarEvent): string {
  const method = event.method ?? "REQUEST";
  const end = new Date(event.start.getTime() + event.minutes * 60_000);
  const cancelled = method === "CANCEL";

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OOVIE//BD Intelligence//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(event.start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsText(event.summary)}`,
    ...(event.description ? [`DESCRIPTION:${icsText(event.description)}`] : []),
    ...(event.url ? [`URL:${event.url}`] : []),
    `ORGANIZER;${person(event.organizer)}`,
    ...(event.attendee
      ? [`ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE;${person(event.attendee)}`]
      : []),
    `SEQUENCE:${event.sequence ?? 0}`,
    `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`,
    // Held time, not free time - and Outlook reads its own property.
    `TRANSP:${cancelled ? "TRANSPARENT" : "OPAQUE"}`,
    `X-MICROSOFT-CDO-BUSYSTATUS:${cancelled ? "FREE" : "BUSY"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  // Trailing CRLF: some parsers drop a final line that is not terminated.
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

/** What the email layer needs to attach one. */
export function icsAttachment(event: CalendarEvent, filename = "invite.ics") {
  return {
    name: filename,
    contentType: "text/calendar",
    contentInBase64: Buffer.from(buildIcs(event), "utf8").toString("base64"),
  };
}
