import { describe, it, expect } from "vitest";
import {
  STALE_DAYS,
  healthOf,
  nextActionFor,
  pipelineHealth,
  withHealth,
} from "@/lib/pipeline/health";
import type { Brand } from "@/lib/types";
import type { Proposal } from "@/lib/crm/types";

const NOW = new Date("2026-08-12T10:00:00.000Z");

/** `days` before today, as yyyy-MM-dd. */
const ago = (days: number): string => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};
const ahead = (days: number) => ago(-days);

const lead = (over: Partial<Brand> = {}): Brand => ({
  id: "l1", name: "Lead One", aliases: [], status: "Early", priority: null,
  owner: null, poc: null, email: null, industry: null, industryRaw: null,
  initialContact: null, lastContact: null, followUpDate: null, closingFailed: null,
  notes: null, scored: false,
  ...over,
});

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: "p1", type: "proposal", companyId: "c1", schemaVersion: 2,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  dealId: "l1", revision: 1, value: 10_000, currency: "EUR", status: "sent",
  sentAt: null, decidedAt: null, validUntil: null, notes: null,
  createdById: null, createdByName: null,
  ...over,
});

// ---------------------------------------------------------------------------

describe("nextActionFor", () => {
  it("takes an explicit answer over anything inferred", () => {
    const explicit = nextActionFor({ waitingOn: "us", followUpDate: ago(3) }, [proposal()]);
    expect(explicit).toMatchObject({ waitingOn: "us", source: "explicit" });
  });

  it("reads a proposal out for decision as waiting on them", () => {
    expect(nextActionFor({ waitingOn: null, followUpDate: null }, [proposal()])).toMatchObject({
      waitingOn: "them",
      source: "proposal",
    });
  });

  it("reads a lone follow-up date as something we said we would do", () => {
    expect(nextActionFor({ waitingOn: null, followUpDate: ahead(5) }, [])).toMatchObject({
      waitingOn: "us",
      dueDate: ahead(5),
      source: "followUp",
    });
  });

  it("says nobody rather than guessing when there is nothing to go on", () => {
    expect(nextActionFor({ waitingOn: null, followUpDate: null }, [])).toEqual({
      waitingOn: null,
      dueDate: null,
      source: "none",
    });
  });

  it("ignores a superseded proposal and reads only the live revision", () => {
    // Re-quoted and then rejected: nothing is sitting with the client.
    const requoted = [
      proposal({ id: "p1", revision: 1, status: "sent" }),
      proposal({ id: "p2", revision: 2, status: "rejected" }),
    ];
    expect(nextActionFor({ waitingOn: null, followUpDate: null }, requoted).waitingOn).toBeNull();
  });

  it("falls back to the proposal's expiry when no follow-up date is set", () => {
    const withExpiry = [proposal({ validUntil: ahead(10) })];
    expect(nextActionFor({ waitingOn: null, followUpDate: null }, withExpiry).dueDate).toBe(ahead(10));
  });

  it("prefers the follow-up date over the proposal expiry", () => {
    const withExpiry = [proposal({ validUntil: ahead(10) })];
    expect(nextActionFor({ waitingOn: null, followUpDate: ahead(2) }, withExpiry).dueDate).toBe(ahead(2));
  });
});

describe("healthOf - the two questions the pipeline has to answer", () => {
  it("flags a reply we owe and have not sent", () => {
    const h = healthOf(lead({ waitingOn: "us", followUpDate: ago(4) }), [], NOW);
    expect(h).toMatchObject({ lateOnUs: true, lateOnThem: false, daysLate: 4 });
  });

  it("flags a chase we owe when they have gone quiet", () => {
    const h = healthOf(lead({ waitingOn: "them", followUpDate: ago(9) }), [], NOW);
    expect(h).toMatchObject({ lateOnUs: false, lateOnThem: true, daysLate: 9 });
  });

  it("is not late on the due date itself", () => {
    // Due today still has today to happen in.
    const h = healthOf(lead({ waitingOn: "us", followUpDate: ago(0) }), [], NOW);
    expect(h.daysLate).toBe(0);
    expect(h.lateOnUs).toBe(false);
  });

  it("is not late before the due date", () => {
    expect(healthOf(lead({ waitingOn: "us", followUpDate: ahead(1) }), [], NOW).lateOnUs).toBe(false);
  });

  it("never marks a finished deal late or stale", () => {
    // A won or lost deal owes nobody anything, however old its dates are - and
    // that includes having no side at all, not just no overdue flag. The
    // pipeline table renders waitingOn directly, so leaving it set showed a
    // closed deal as still waiting on us.
    for (const status of ["Deal Closed", "Did not work out"] as const) {
      const h = healthOf(
        lead({ status, waitingOn: "us", followUpDate: ago(200), lastContact: ago(400) }),
        [],
        NOW,
      );
      expect(h, status).toMatchObject({
        waitingOn: null,
        lateOnUs: false,
        lateOnThem: false,
        stale: false,
        untriaged: false,
      });
    }
  });

  it("gives a closed deal no side even when a proposal is still out", () => {
    const h = healthOf(lead({ status: "Deal Closed" }), [proposal({ status: "sent" })], NOW);
    expect(h.waitingOn).toBeNull();
  });

  it("counts an open lead nobody owns as untriaged, not as on us", () => {
    const h = healthOf(lead(), [], NOW);
    expect(h).toMatchObject({ untriaged: true, lateOnUs: false, lateOnThem: false, waitingOn: null });
  });

  it("measures staleness from the last contact", () => {
    expect(healthOf(lead({ lastContact: ago(STALE_DAYS + 1) }), [], NOW).stale).toBe(true);
    expect(healthOf(lead({ lastContact: ago(STALE_DAYS) }), [], NOW).stale).toBe(false);
    expect(healthOf(lead({ lastContact: ago(STALE_DAYS + 1) }), [], NOW).daysSinceContact).toBe(STALE_DAYS + 1);
  });

  it("reports no contact date as unknown rather than as stale", () => {
    // Never contacted is a different problem from gone cold, and lumping them
    // together hides both.
    const h = healthOf(lead({ lastContact: null }), [], NOW);
    expect(h.daysSinceContact).toBeNull();
    expect(h.stale).toBe(false);
  });

  it("survives an unparseable date instead of reporting a huge overdue", () => {
    const h = healthOf(lead({ waitingOn: "us", followUpDate: "not-a-date", lastContact: "??" }), [], NOW);
    expect(h.daysLate).toBe(0);
    expect(h.lateOnUs).toBe(false);
    expect(h.daysSinceContact).toBeNull();
  });

  it("treats a sent proposal past its expiry as them being late", () => {
    const h = healthOf(lead(), [proposal({ validUntil: ago(5) })], NOW);
    expect(h).toMatchObject({ waitingOn: "them", lateOnThem: true, daysLate: 5, source: "proposal" });
  });

  it("lets an explicit side override what the proposal implies", () => {
    // They asked a question about the quote: the ball came back to us.
    const h = healthOf(lead({ waitingOn: "us", followUpDate: ago(2) }), [proposal()], NOW);
    expect(h).toMatchObject({ waitingOn: "us", lateOnUs: true, lateOnThem: false, source: "explicit" });
  });
});

describe("pipelineHealth", () => {
  const brands: Brand[] = [
    lead({ id: "a", waitingOn: "us", followUpDate: ago(3) }),
    lead({ id: "b", waitingOn: "them", followUpDate: ago(1) }),
    lead({ id: "c" }),
    lead({ id: "d", lastContact: ago(120) }),
    lead({ id: "e", status: "Deal Closed", waitingOn: "us", followUpDate: ago(99) }),
  ];

  it("counts each problem separately over open leads only", () => {
    const h = pipelineHealth(brands, [], NOW);
    expect(h.open).toBe(4);
    expect(h.lateOnUs).toBe(1);
    expect(h.lateOnThem).toBe(1);
    // c has nothing at all; d has only a stale contact date.
    expect(h.untriaged).toBe(2);
    expect(h.stale).toBe(1);
  });

  it("sums euros sitting with clients awaiting a greenlight", () => {
    const proposals = [
      proposal({ id: "p1", dealId: "a", value: 10_000, status: "sent" }),
      proposal({ id: "p2", dealId: "b", value: 25_000, status: "sent" }),
      proposal({ id: "p3", dealId: "c", value: 99_000, status: "draft" }),
    ];
    expect(pipelineHealth(brands, proposals, NOW).awaitingGreenlightEur).toBe(35_000);
  });

  it("counts only the live revision of a re-quoted deal", () => {
    const requoted = [
      proposal({ id: "p1", dealId: "a", revision: 1, value: 10_000, status: "sent" }),
      proposal({ id: "p2", dealId: "a", revision: 2, value: 12_000, status: "sent" }),
    ];
    expect(pipelineHealth(brands, requoted, NOW).awaitingGreenlightEur).toBe(12_000);
  });

  it("excludes money quoted on a deal that has since closed", () => {
    // e is won: its old quote is history, not money we are waiting on.
    const onClosed = [proposal({ id: "p9", dealId: "e", value: 50_000, status: "sent" })];
    expect(pipelineHealth(brands, onClosed, NOW).awaitingGreenlightEur).toBe(0);
  });

  it("reports zeroes rather than throwing on an empty pipeline", () => {
    expect(pipelineHealth([], [], NOW)).toEqual({
      open: 0, lateOnUs: 0, lateOnThem: 0, untriaged: 0, stale: 0, awaitingGreenlightEur: 0,
    });
  });
});

describe("withHealth", () => {
  it("attaches each lead's own proposals and nobody else's", () => {
    const rows = withHealth(
      [lead({ id: "a" }), lead({ id: "b" })],
      [proposal({ id: "p1", dealId: "a", status: "sent" })],
      NOW,
    );
    expect(rows.find((r) => r.brand.id === "a")!.health.waitingOn).toBe("them");
    expect(rows.find((r) => r.brand.id === "b")!.health.waitingOn).toBeNull();
  });

  it("keeps the input order so a sorted table stays sorted", () => {
    const rows = withHealth([lead({ id: "b" }), lead({ id: "a" })], [], NOW);
    expect(rows.map((r) => r.brand.id)).toEqual(["b", "a"]);
  });
});
