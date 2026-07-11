import { describe, it, expect } from "vitest";
import { blocksToMarkdown, tableBlockToCsv, conversationToMarkdown } from "@/lib/copilot/serialize";
import { b } from "@/lib/copilot/blocks";

describe("blocksToMarkdown", () => {
  it("renders headings, metrics and tables", () => {
    const md = blocksToMarkdown([
      b.heading("Pipeline", { subtitle: "64 leads" }),
      b.metrics([{ label: "Total", value: 64 }]),
      b.table([{ key: "n", label: "Name" }], [{ n: "Alibaba" }]),
    ]);
    expect(md).toContain("### Pipeline");
    expect(md).toContain("- **Total:** 64");
    expect(md).toContain("| Name |");
    expect(md).toContain("| Alibaba |");
  });
});

describe("tableBlockToCsv", () => {
  it("serializes a table block to CSV", () => {
    const block = b.table(
      [
        { key: "n", label: "Name" },
        { key: "s", label: "Score" },
      ],
      [
        { n: "A", s: 3 },
        { n: "B", s: 4 },
      ],
    );
    if (block.type !== "table") throw new Error("expected table block");
    expect(tableBlockToCsv(block)).toBe("Name,Score\r\nA,3\r\nB,4");
  });
});

describe("conversationToMarkdown", () => {
  it("includes both user and assistant turns", () => {
    const md = conversationToMarkdown([
      { role: "user", text: "hi" },
      { role: "assistant", blocks: [b.text("hello")] },
    ]);
    expect(md).toContain("**You:** hi");
    expect(md).toContain("hello");
  });
});
