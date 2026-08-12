import { describe, it, expect } from "vitest";
import { renderTemplate, OUTREACH_TEMPLATES } from "@/lib/mail/templates";
import type { Brand } from "@/lib/types";

function brand(o: Partial<Brand> = {}): Brand {
  return {
    id: "alibaba",
    name: "Alibaba",
    aliases: [],
    status: null,
    priority: null,
    owner: null,
    poc: "Jane Doe",
    email: "jane@alibaba.com",
    industry: "Tech/Telecom",
    industryRaw: "Tech/Telecom",
    initialContact: null,
    lastContact: null,
    followUpDate: null,
    closingFailed: null,
    notes: null,
    scored: false,
    ...o,
  };
}

describe("renderTemplate", () => {
  it("fills brand name, contact first name and sender", () => {
    const r = renderTemplate("intro", { brand: brand(), senderName: "Rick" });
    expect(r.subject).toContain("Alibaba");
    expect(r.body).toContain("Hi Jane,");
    expect(r.body).toContain("Rick");
    expect(r.body).toContain("OOVIE Studios");
  });

  it("falls back to 'there' when there is no POC", () => {
    const r = renderTemplate("intro", { brand: brand({ poc: null }), senderName: "Rick" });
    expect(r.body).toContain("Hi there,");
  });

  it("treats an unknown template id as the intro template", () => {
    const unknown = renderTemplate("nope", { brand: brand(), senderName: "Rick" });
    const intro = renderTemplate("intro", { brand: brand(), senderName: "Rick" });
    expect(unknown).toEqual(intro);
  });

  it("renders every declared template non-empty", () => {
    for (const t of OUTREACH_TEMPLATES) {
      const r = renderTemplate(t.id, { brand: brand(), senderName: "Rick" });
      expect(r.subject.length).toBeGreaterThan(0);
      expect(r.body.length).toBeGreaterThan(0);
    }
  });
});
