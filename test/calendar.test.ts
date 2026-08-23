import { describe, it, expect } from "vitest";
import { buildIcs, icsStamp, icsText, foldLine, icsAttachment } from "@/lib/mail/calendar";

const base = {
  uid: "reminder-abc@oovie",
  start: new Date("2026-09-01T14:00:00.000Z"),
  minutes: 30,
  summary: "Work on the Alleanza quote",
  organizer: { name: "BD Intelligence", email: "DoNotReply@example.azurecomm.net" },
  attendee: { name: "Ada Lovelace", email: "ada@oovie.dev" },
};

const lines = (ics: string) => ics.split("\r\n");

/** Rejoin folded lines the way a parser does, so assertions read the property. */
const unfold = (ics: string) => ics.replace(/\r\n /g, "");
const find = (ics: string, prefix: string) => unfold(ics).split("\r\n").find((l) => l.startsWith(prefix));

describe("icsStamp", () => {
  it("writes UTC basic format", () => {
    expect(icsStamp(new Date("2026-09-01T14:05:09.123Z"))).toBe("20260901T140509Z");
  });
});

describe("icsText", () => {
  it("escapes the separators that would otherwise end the property", () => {
    expect(icsText("a;b,c")).toBe("a\\;b\\,c");
  });

  it("escapes backslashes before anything else", () => {
    // Doing it later would re-escape the escapes just written.
    expect(icsText("a\\b;c")).toBe("a\\\\b\\;c");
  });

  it("turns newlines into the literal escape a calendar expects", () => {
    expect(icsText("one\ntwo")).toBe("one\\ntwo");
    expect(icsText("one\r\ntwo")).toBe("one\\ntwo");
  });
});

describe("foldLine", () => {
  it("leaves a short line alone", () => {
    expect(foldLine("SUMMARY:short")).toBe("SUMMARY:short");
  });

  it("folds a long line with a leading space on continuations", () => {
    const folded = foldLine(`DESCRIPTION:${"x".repeat(200)}`);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.slice(1).every((p) => p.startsWith(" "))).toBe(true);
    expect(parts[0].length).toBeLessThanOrEqual(75);
  });

  it("counts octets, not characters", () => {
    // Accented text fits the character limit and busts the octet limit, which
    // is what strict parsers actually reject.
    const folded = foldLine(`SUMMARY:${"é".repeat(50)}`);
    for (const part of folded.split("\r\n")) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    }
  });

  it("loses nothing it folded", () => {
    const original = `DESCRIPTION:${"abcde ".repeat(40)}`;
    expect(foldLine(original).replace(/\r\n /g, "")).toBe(original);
  });
});

describe("buildIcs", () => {
  it("produces a single well-formed event", () => {
    const ics = buildIcs(base);
    expect(lines(ics)[0]).toBe("BEGIN:VCALENDAR");
    expect(lines(ics).filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("uses CRLF, which is what strict parsers require", () => {
    expect(buildIcs(base)).not.toMatch(/[^\r]\n/);
  });

  it("defaults to an invitation the client can accept", () => {
    expect(find(buildIcs(base), "METHOD:")).toBe("METHOD:REQUEST");
  });

  it("blocks the time rather than showing it free", () => {
    const ics = buildIcs(base);
    expect(find(ics, "TRANSP:")).toBe("TRANSP:OPAQUE");
    expect(find(ics, "X-MICROSOFT-CDO-BUSYSTATUS:")).toBe("X-MICROSOFT-CDO-BUSYSTATUS:BUSY");
  });

  it("ends the event after exactly the minutes asked for", () => {
    expect(find(buildIcs({ ...base, minutes: 15 }), "DTEND:")).toBe("DTEND:20260901T141500Z");
    expect(find(buildIcs({ ...base, minutes: 30 }), "DTEND:")).toBe("DTEND:20260901T143000Z");
  });

  it("keeps the uid stable so a re-send updates instead of duplicating", () => {
    expect(find(buildIcs(base), "UID:")).toBe("UID:reminder-abc@oovie");
    expect(find(buildIcs({ ...base, sequence: 2 }), "SEQUENCE:")).toBe("SEQUENCE:2");
  });

  it("cancels an event without deleting the record of it", () => {
    const ics = buildIcs({ ...base, method: "CANCEL", sequence: 1 });
    expect(find(ics, "METHOD:")).toBe("METHOD:CANCEL");
    expect(find(ics, "STATUS:")).toBe("STATUS:CANCELLED");
    // A cancelled block must give the time back.
    expect(find(ics, "TRANSP:")).toBe("TRANSP:TRANSPARENT");
    expect(find(ics, "X-MICROSOFT-CDO-BUSYSTATUS:")).toBe("X-MICROSOFT-CDO-BUSYSTATUS:FREE");
  });

  it("names the organiser and the attendee as mailto addresses", () => {
    const ics = buildIcs(base);
    expect(find(ics, "ORGANIZER")).toContain("mailto:DoNotReply@example.azurecomm.net");
    expect(find(ics, "ATTENDEE")).toContain("mailto:ada@oovie.dev");
  });

  it("omits the attendee for a personal block", () => {
    const ics = buildIcs({ ...base, attendee: undefined, method: "PUBLISH" });
    expect(find(ics, "ATTENDEE")).toBeUndefined();
    expect(find(ics, "METHOD:")).toBe("METHOD:PUBLISH");
  });

  it("escapes a description carrying CRM detail", () => {
    const ics = buildIcs({ ...base, description: "Budget: 40,000; stage: Advanced\nOwner: Ada" });
    const description = find(ics, "DESCRIPTION:")!;
    expect(description).toContain("40\\,000");
    expect(description).toContain("\\;");
    expect(description).toContain("\\n");
  });
});

describe("icsAttachment", () => {
  it("hands the mail layer exactly what ACS accepts", () => {
    const attachment = icsAttachment(base, "reminder.ics");
    expect(attachment.name).toBe("reminder.ics");
    // ACS validates the MIME type against its supported list; text/calendar is
    // the one it publishes for .ics.
    expect(attachment.contentType).toBe("text/calendar");
    expect(Buffer.from(attachment.contentInBase64, "base64").toString("utf8")).toContain("BEGIN:VCALENDAR");
  });
});
