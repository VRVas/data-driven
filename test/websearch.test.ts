import { describe, it, expect } from "vitest";
import { normalizeWebAnswer, type RetrieveResponse } from "@/lib/copilot/websearch";

const sample: RetrieveResponse = {
  response: [
    { content: [{ text: "Part one.[ref_id:0] " }, { text: "Part two.[ref_id:2]" }] },
  ],
  references: [
    { id: "0", type: "web", title: "Alpha", url: "https://a.example/x" },
    { id: "1", type: "web", title: "Beta", url: "https://b.example/y" },
    { id: "2", type: "web", title: "Gamma", url: "https://c.example/z" },
  ],
};

describe("web grounding parser", () => {
  it("flattens the synthesized answer across messages and content parts", () => {
    const { answer } = normalizeWebAnswer(sample);
    expect(answer).toContain("Part one.");
    expect(answer).toContain("Part two.");
  });

  it("renumbers [ref_id:N] markers to 1-based [n] aligned to the sources", () => {
    const { answer, sources } = normalizeWebAnswer(sample);
    // id 0 -> [1], id 2 -> [3]
    expect(answer).toContain("Part one.[1]");
    expect(answer).toContain("Part two.[3]");
    expect(sources.map((s) => s.n)).toEqual([1, 2, 3]);
    expect(sources[2]).toMatchObject({ n: 3, title: "Gamma", url: "https://c.example/z" });
  });

  it("drops references without a url and caps the list at 8", () => {
    const many: RetrieveResponse = {
      response: [{ content: [{ text: "x" }] }],
      references: [
        { id: "n", type: "web", title: "no url" }, // dropped (no url)
        ...Array.from({ length: 12 }, (_, i) => ({ id: String(i), type: "web", title: `T${i}`, url: `https://e/${i}` })),
      ],
    };
    const { sources } = normalizeWebAnswer(many);
    expect(sources).toHaveLength(8);
    expect(sources.every((s) => s.url.startsWith("https://"))).toBe(true);
  });

  it("removes markers that point to dropped references", () => {
    const { answer } = normalizeWebAnswer({
      response: [{ content: [{ text: "cited[ref_id:0] and orphan[ref_id:99]" }] }],
      references: [{ id: "0", type: "web", title: "A", url: "https://a" }],
    });
    expect(answer).toBe("cited[1] and orphan");
  });

  it("handles empty / missing data safely", () => {
    expect(normalizeWebAnswer({})).toEqual({ answer: "", sources: [] });
    expect(normalizeWebAnswer({ response: [], references: [] })).toEqual({ answer: "", sources: [] });
  });
});
