import { describe, it, expect } from "vitest";
import { parseBlocks, b, toneVar, BlockSchema } from "@/lib/copilot/blocks";

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

  it("builders produce schema-valid blocks", () => {
    const built = [
      b.heading("Title", { eyebrow: "Eyebrow", subtitle: "Sub" }),
      b.metrics([{ label: "a", value: 1, tone: "mint" }]),
      b.chart("donut", { series: [{ label: "x", value: 1 }] }),
      b.table([{ key: "k", label: "K" }], [{ k: "v" }]),
      b.leadGrid([{ id: "a", name: "A", score: 3.2 }]),
      b.recommendation("Do X", "because", 0.8),
      b.actions([{ label: "Go", tool: "draft_outreach", args: { id: "a" }, style: "primary" }]),
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
