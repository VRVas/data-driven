import { describe, expect, it } from "vitest";
import type { Block } from "@/lib/copilot/blocks";
import { escapeMarkdownV2, renderAnswer, renderRuns, safeUrl } from "@/lib/copilot/external/render";

describe("external renderers", () => {
  it("escapes every Telegram-reserved character", () => {
    for (const character of "_*[]()~`>#+-=|{}.!\\") expect(escapeMarkdownV2(character)).toBe(`\\${character}`);
  });

  it("chunks escaped text on Unicode boundaries and closes formatting", () => {
    const messages = renderRuns([{ text: "A_!".repeat(4000) + "\u{1f600}".repeat(3000), bold: true }], "telegram-markdownv2");
    expect(messages.length).toBeGreaterThan(2);
    for (const message of messages) {
      expect(message.text.length).toBeLessThanOrEqual(3500);
      expect(message.text.startsWith("*")).toBe(true);
      expect(message.text.endsWith("*")).toBe(true);
      expect(message.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
    }
  });

  it("preserves scatter data and all table rows as artifacts", () => {
    const blocks: Block[] = [
      { type: "chart", variant: "scatter", title: "Quadrant", points: [{ x: 12, y: 34, label: "Fixture", size: 56 }] },
      { type: "table", columns: [{ key: "name", label: "Name" }], rows: Array.from({ length: 20 }, (_, index) => ({ name: `Fixture ${index}` })) },
    ];
    const answer = renderAnswer(blocks, "plain-text", "https://example.invalid");
    expect(answer.messages.map((message) => message.text).join("")).toContain("x 12; y 34; size 56");
    expect(JSON.parse(answer.artifacts[0].text).points).toEqual([{ x: 12, y: 34, label: "Fixture", size: 56 }]);
    expect(answer.artifacts[1].text).toContain("Fixture 19");
    expect(answer.warnings).toContain("table_preview_truncated");
  });

  it("does not expose reasoning or turn unsafe links into clickable URLs", () => {
    const answer = renderAnswer([
      { type: "reasoning", text: "Internal fixture reasoning" },
      { type: "text", text: "**A_[name]** and [unsafe](javascript:alert)" },
    ], "telegram-markdownv2", "https://example.invalid");
    expect(JSON.stringify(answer)).not.toContain("Internal fixture reasoning");
    expect(answer.messages[0].text).not.toContain("javascript:");
    expect(safeUrl("https://user:secret@example.invalid")).toBeUndefined();
  });

  it("protects CSV consumers from formula-like values", () => {
    const answer = renderAnswer([{ type: "table", columns: [{ key: "name", label: "Name" }], rows: [{ name: "=SUM(1,2)" }] }], "json", "https://example.invalid");
    expect(answer.artifacts[0].text).toContain("'=SUM");
  });

  it("retains authorized table data without granting CSV export", () => {
    const answer = renderAnswer([{ type: "table", columns: [{ key: "name", label: "Name" }], rows: [{ name: "Fixture" }] }], "json", "https://example.invalid", [], false);
    expect(answer.artifacts[0].mediaType).toBe("application/json");
    expect(JSON.parse(answer.artifacts[0].text).rows).toEqual([{ name: "Fixture" }]);
  });
});