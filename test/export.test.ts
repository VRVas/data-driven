import { describe, it, expect } from "vitest";
import { toCsv, toJson, stampName } from "@/lib/export";

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
