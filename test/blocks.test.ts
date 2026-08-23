import { describe, it, expect } from "vitest";
import { parseBlocks, b, toneVar, BlockSchema } from "@/lib/copilot/blocks";
import { blocksToMarkdown } from "@/lib/copilot/serialize";

describe("block protocol", () => {
  it("keeps valid blocks and drops invalid ones", () => {
    const blocks = parseBlocks({
      blocks: [
        { type: "heading", title: "Hi" },
        { type: "nope" }, // unknown type
        { type: "metrics", items: [{ label: "A", value: 1 }] },
        { type: "chart", variant: "bar", series: [{ label: "x", value: 2 }] },
        { type: "text" }, // missing required text
      ],
    });
    expect(blocks.map((x) => x.type)).toEqual(["heading", "metrics", "chart"]);
  });

  it("accepts a bare array and rejects junk", () => {
    expect(parseBlocks([{ type: "divider" }])).toHaveLength(1);
    expect(parseBlocks("garbage")).toEqual([]);
    expect(parseBlocks(null)).toEqual([]);
  });

  it("trims an over-long block instead of throwing the whole thing away", () => {
    // The caps stop one answer flooding the panel. Rejecting the block for
    // breaching them deleted every metric the model wrote, which is how a
    // reply ended up looking truncated for no visible reason.
    const items = Array.from({ length: 14 }, (_, i) => ({ label: `m${i}`, value: i }));
    const [block] = parseBlocks({ blocks: [{ type: "metrics", items }] });

    expect(block.type).toBe("metrics");
    expect((block as { items: unknown[] }).items).toHaveLength(8);
  });

  it("trims the offending list only, leaving its siblings alone", () => {
    const [block] = parseBlocks({
      blocks: [
        {
          type: "scoreBreakdown",
          name: "Acme",
          priority: 72,
          opportunity: 60,
          winnability: 85,
          drivers: Array.from({ length: 9 }, (_, i) => ({ label: `d${i}`, detail: "why" })),
        },
      ],
    });
    expect(block.type).toBe("scoreBreakdown");
    expect((block as { drivers: unknown[] }).drivers).toHaveLength(6);
    expect((block as { name: string }).name).toBe("Acme");
  });

  it("keeps the prose of a block it cannot render", () => {
    const [block] = parseBlocks({ blocks: [{ type: "somethingNew", text: "Worth reading anyway." }] });
    expect(block).toEqual({ type: "text", text: "Worth reading anyway." });
  });

  it("still drops a block with nothing salvageable in it", () => {
    expect(parseBlocks({ blocks: [{ type: "nope" }, { type: "text" }] })).toEqual([]);
  });

  it("builders produce schema-valid blocks", () => {
    const built = [
      b.heading("Title", { eyebrow: "Eyebrow", subtitle: "Sub" }),
      b.metrics([{ label: "a", value: 1, tone: "mint" }]),
      b.chart("donut", { series: [{ label: "x", value: 1 }] }),
      b.table([{ key: "k", label: "K" }], [{ k: "v" }]),
      b.leadGrid([{ id: "a", name: "A", score: 3.2 }]),
      b.recommendation("Do X", "because", 0.8),
      b.actions([{ label: "Go", tool: "draft_outreach", args: { id: "a" }, style: "primary" }]),
      b.sources([{ n: 1, title: "Alpha", url: "https://a.example/x" }], "Sources"),
    ];
    for (const block of built) {
      expect(BlockSchema.safeParse(block).success).toBe(true);
    }
  });

  it("maps tones (and callout tones) to design-system vars", () => {
    expect(toneVar("mint")).toContain("--color-mint");
    expect(toneVar("danger")).toContain("--color-rose");
    expect(toneVar("brand")).toContain("--color-brand");
    expect(toneVar(undefined)).toContain("--color-ink-muted");
  });
});

describe("companyCard", () => {
  it("round-trips a relationship rollup", () => {
    const [block] = parseBlocks([
      { type: "companyCard", id: "co-x", name: "Generali", openDealCount: 2, wonDealCount: 1, lifetimeValueEur: 90000, repeatValueEur: 40000 },
    ]);
    expect(block.type).toBe("companyCard");
    expect(blocksToMarkdown([block])).toContain("Generali");
    expect(blocksToMarkdown([block])).toContain("repeat");
  });

  it("survives a company with nothing won yet", () => {
    const [block] = parseBlocks([{ type: "companyCard", id: "co-y", name: "New Co" }]);
    expect(block).toBeTruthy();
    expect(blocksToMarkdown([block])).toContain("New Co");
  });
});

describe("scoreBreakdown", () => {
  it("shows both axes and the geometric mean that joins them", () => {
    const [block] = parseBlocks([
      { type: "scoreBreakdown", name: "DELL EMEA", priority: 74, grade: "A", quadrant: "Pursue", opportunity: 75, winnability: 73, ease: 60 },
    ]);
    expect(block.type).toBe("scoreBreakdown");
    const md = blocksToMarkdown([block]);
    expect(md).toContain("priority 74");
    expect(md).toContain("Opportunity: 75");
    expect(md).toContain("Winnability: 73");
    // Ease is reported but must read as excluded, not as an input.
    expect(md).toContain("never blended in");
  });

  it("rejects a breakdown missing an axis rather than rendering half a story", () => {
    expect(parseBlocks([{ type: "scoreBreakdown", name: "X", priority: 10, opportunity: 20 }])).toEqual([]);
  });
});
