import { describe, it, expect } from "vitest";
import { escapeXml, buildSsml } from "@/lib/speech/provider";
import { blocksToSpeech } from "@/lib/copilot/serialize";
import { b } from "@/lib/copilot/blocks";

describe("speech SSML", () => {
  it("escapes XML special characters", () => {
    expect(escapeXml(`a & b < c > "d" 'e'`)).toBe(
      "a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;",
    );
  });

  it("builds valid SSML with the voice + language", () => {
    const ssml = buildSsml("Hello & welcome", "it-IT-Luca:MAI-Voice-2", "en-US");
    expect(ssml.startsWith("<speak")).toBe(true);
    expect(ssml).toContain('xml:lang="en-US"');
    expect(ssml).toContain('<voice name="it-IT-Luca:MAI-Voice-2">');
    expect(ssml).toContain("Hello &amp; welcome");
    expect(ssml.trim().endsWith("</speak>")).toBe(true);
  });
});

describe("blocksToSpeech", () => {
  it("produces clean prose and skips visual-only blocks", () => {
    const blocks = [
      b.heading("Alibaba", { subtitle: "Score 4.2" }),
      b.text("This lead is **hot**."),
      b.chart("bar", { max: 1, series: [{ label: "x", value: 1 }] }),
    ];
    const speech = blocksToSpeech(blocks);
    expect(speech).toContain("Alibaba");
    expect(speech).toContain("Score 4.2");
    expect(speech).toContain("This lead is hot");
    expect(speech).not.toContain("*");
  });

  it("returns empty string for only visual blocks", () => {
    const speech = blocksToSpeech([b.chart("donut", { series: [{ label: "a", value: 1 }] })]);
    expect(speech).toBe("");
  });
});
