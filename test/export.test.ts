import { describe, it, expect } from "vitest";
import { toCsv, toJson, toXlsx, toPdf, stampName } from "@/lib/export";

describe("toCsv", () => {
  it("writes a header row and data rows", () => {
    const csv = toCsv(
      [
        { key: "a", label: "A" },
        { key: "b", label: "B" },
      ],
      [
        { a: 1, b: 2 },
        { a: 3, b: 4 },
      ],
    );
    expect(csv).toBe("A,B\r\n1,2\r\n3,4");
  });

  it("escapes commas, quotes and newlines (RFC-4180)", () => {
    const csv = toCsv([{ key: "x", label: "X" }], [{ x: "a,b" }, { x: 'he said "hi"' }, { x: "l1\nl2" }]);
    expect(csv).toBe('X\r\n"a,b"\r\n"he said ""hi"""\r\n"l1\nl2"');
  });

  it("renders null / missing as empty cells", () => {
    expect(toCsv([{ key: "a", label: "A" }], [{ a: null }, {}])).toBe("A\r\n\r\n");
  });

  it("emits just the header when there are no rows", () => {
    expect(toCsv([{ key: "a", label: "A" }], [])).toBe("A");
  });
});

describe("toJson", () => {
  it("pretty-prints", () => {
    expect(toJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

describe("stampName", () => {
  it("appends an ISO date", () => {
    expect(stampName("pipeline", new Date("2026-07-11T10:00:00Z"))).toBe("pipeline-2026-07-11");
  });
});

const cols = [
  { key: "name", label: "Name" },
  { key: "score", label: "Score" },
];
const data = [
  { name: "Alibaba", score: 4.2 },
  { name: 'A "tricky" & <name>', score: null },
];

describe("toXlsx", () => {
  it("produces a ZIP (xlsx) with the PK signature", () => {
    const bytes = toXlsx(cols, data);
    // Local file header magic: 'P','K',0x03,0x04
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(bytes.length).toBeGreaterThan(300);
  });

  it("embeds the worksheet part and escapes XML in cell values", () => {
    const text = new TextDecoder().decode(toXlsx(cols, data));
    expect(text).toContain("xl/worksheets/sheet1.xml");
    expect(text).toContain("[Content_Types].xml");
    expect(text).toContain("Alibaba");
    // header + escaped special chars, numeric cell written as <v>
    expect(text).toContain("&quot;tricky&quot; &amp; &lt;name&gt;");
    expect(text).toContain("<v>4.2</v>");
  });

  it("writes just the header row when there are no data rows", () => {
    const text = new TextDecoder().decode(toXlsx(cols, []));
    expect(text).toContain('<row r="1">');
    expect(text).not.toContain('<row r="2">');
  });
});

describe("toPdf", () => {
  it("produces a valid PDF document (header, xref, trailer)", () => {
    const bytes = toPdf("Pipeline", cols, data);
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.startsWith("%PDF-1.")).toBe(true);
    expect(text).toContain("/Type /Catalog");
    expect(text).toContain("xref");
    expect(text).toContain("startxref");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("paginates large tables across multiple pages", () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ name: `Lead ${i}`, score: i }));
    const text = new TextDecoder("latin1").decode(toPdf("Big", cols, many));
    const pageCount = (text.match(/\/Type \/Page[^s]/g) ?? []).length;
    expect(pageCount).toBeGreaterThan(1);
  });

  it("escapes PDF-reserved characters in cell text", () => {
    const text = new TextDecoder("latin1").decode(toPdf("T", cols, [{ name: "a(b)c\\d", score: 1 }]));
    expect(text).toContain("a\\(b\\)c\\\\d");
  });
});
