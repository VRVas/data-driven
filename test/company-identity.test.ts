import { describe, it, expect } from "vitest";
import { companyNameKey, companyRoot, duplicateCandidates } from "@/lib/crm/logic";
import type { Company } from "@/lib/crm/types";

/**
 * Company identity under adversarial names.
 *
 * The suggester is meant to be over-inclusive: it puts a question in front of a
 * human and never merges anything. Over-inclusive is not the same as grouping
 * on no information, though, and the difference is what these pin down.
 */
const company = (id: string, name: string): Company =>
  ({ id, companyId: id, name, rollup: {} } as unknown as Company);

const groupsOf = (names: string[]) =>
  duplicateCandidates(names.map((n, i) => company(`c${i}`, n))).map((g) => g.map((c) => c.name).sort());

describe("company name normalisation", () => {
  it("folds legal suffixes however they are punctuated", () => {
    for (const n of ["ACME S.p.A.", "ACME SpA", "acme  spa", "ACME S.P.A", "Acme Group"]) {
      expect(companyNameKey(n), n).toBe("acme");
    }
  });

  it("folds accents, so one client is not two records", () => {
    expect(companyNameKey("Café Noir")).toBe(companyNameKey("Cafe Noir"));
    expect(companyNameKey("Nestlé")).toBe("nestle");
  });

  it("treats punctuation as a separator except inside abbreviations", () => {
    expect(companyNameKey("AT&T")).toBe("at t");
    expect(companyNameKey("L'Oréal")).toBe("loreal");
    expect(companyNameKey("Generali - Taverna")).toBe("generali taverna");
  });

  it("produces no key at all for a name that is only a suffix or only symbols", () => {
    // No key means no group, which is the safe direction: a nameless record
    // must never be suggested as a duplicate of another nameless one.
    for (const n of ["S.p.A.", "   ", "日本語", "---"]) expect(companyNameKey(n), n).toBe("");
  });

  it("ignores case and stray whitespace", () => {
    expect(companyNameKey("  ALLIANZ   bank ")).toBe(companyNameKey("Allianz Bank"));
  });
});

describe("the duplicate suggester", () => {
  it("groups the real case it exists for", () => {
    // Neither exact keys nor a full-string match would ever pair these.
    expect(groupsOf(["Generali - Taverna", "Generali Bank"])).toEqual([["Generali - Taverna", "Generali Bank"].sort()]);
  });

  it("still pairs clients that merely share a first word", () => {
    // Deliberate. Qatar Airways and Qatar Museums are different companies and
    // are suggested anyway, because a human dismissing a wrong guess is cheaper
    // than a missed duplicate.
    expect(groupsOf(["Qatar Airways", "Qatar Museums"])).toHaveLength(1);
    expect(groupsOf(["Allianz Bank", "Allianz CH"])).toHaveLength(1);
  });

  it("does not group on a leading article", () => {
    // Every "The ..." in the book used to land in one pile, which buries the
    // candidates the card exists to surface.
    expect(groupsOf(["The Coca-Cola Company", "The Body Shop", "The North Face"])).toEqual([]);
    expect(groupsOf(["Il Sole 24 Ore", "La Rinascente", "Le Bon Marché"])).toEqual([]);
  });

  it("sees through an article to the client behind it", () => {
    // The other half of the same bug: these are one client written two ways,
    // and grouping on "the" never matched them.
    expect(groupsOf(["The Body Shop", "Body Shop"])).toEqual([["Body Shop", "The Body Shop"]]);
    expect(companyRoot("La Rinascente")).toBe("rinascente");
  });

  it("keeps a name that is nothing but an article usable", () => {
    expect(companyRoot("The")).toBe("the");
    expect(companyRoot("")).toBe("");
  });

  it("never suggests a company against itself", () => {
    expect(groupsOf(["Alibaba"])).toEqual([]);
    expect(groupsOf([])).toEqual([]);
  });

  it("skips a company that has already been merged away", () => {
    const a = company("a", "Allianz Bank");
    const b = { ...company("b", "Allianz CH"), mergedIntoCompanyId: "a" } as Company;
    expect(duplicateCandidates([a, b])).toEqual([]);
  });

  it("puts every member of a bigger family in one group", () => {
    const groups = groupsOf(["Banca Aletti", "Banca Sella", "Banca Patrimoni", "Alibaba"]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });
});
