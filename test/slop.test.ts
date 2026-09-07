import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The no-ai-slop rules, enforced on the copy a user actually reads.
 *
 * The skill is in .github/skills/no-ai-slop and most of it needs judgement -
 * voice, cadence, whether a qualifier earns its place. That half is a review,
 * not a test. What IS mechanical is the banned vocabulary, the empty phrases
 * and a handful of sentence shapes, and those decay the moment nobody is
 * looking, exactly like the em dash did.
 *
 * Scoped to user-facing strings on purpose. Code comments are written for the
 * next developer and a rule like "cut the word just" would be wrong there and
 * noisy enough to get the whole guard switched off.
 */
const COPY_ROOTS = ["src/app", "src/components"];
const COPY_FILES = [
  "src/lib/tour/steps.ts",
  "src/lib/leads/field-help.ts",
  "src/lib/mail/templates.ts",
  "src/lib/auth/catalogue.ts",
  "src/lib/pipeline/hygiene.ts",
  "src/lib/pipeline/rubric.ts",
  "src/lib/copilot/provider.ts",
  "src/lib/copilot/intake.ts",
  "src/lib/copilot/suggest.ts",
  "src/lib/copilot/platform-spec.ts",
  "src/lib/copilot/model-spec.ts",
];

/** Marketing verbs and nouns that say nothing. From the skill's banned list. */
const BANNED = [
  "delve", "foster", "leverage", "utilize", "utilise", "facilitate", "empower",
  "streamline", "cutting-edge", "paradigm shift", "game changer", "game-changer",
  "this is huge", "this changes everything", "tapestry", "multifaceted",
  "meticulous", "paramount", "transformative", "supercharge", "ever-evolving",
  "seamless", "seamlessly", "unleash", "best-in-class", "world-class",
  "revolutionize", "revolutionise", "effortless", "turbocharge",
];

const EMPTY_PHRASES = [
  "it's worth noting", "it is worth noting", "it's important to note",
  "it is important to note", "at the end of the day", "at its core",
  "in today's world", "in the age of", "in the world of", "the reality is",
  "going forward", "in this article", "let's dive in", "needless to say",
  "rest assured", "when it comes to",
];

const SHAPES: [RegExp, string][] = [
  [/\bit'?s not just [^.;"]{2,40}[,.] it'?s\b/i, "binary contrast - state the second half directly"],
  [/\bthe question isn'?t\b/i, "binary contrast - state the answer directly"],
  [/\bhere'?s the thing\b/i, "throat-clearing opener - cut it"],
  [/\blet me be clear\b/i, "throat-clearing opener - cut it"],
  [/\bwhat (most people|nobody|everyone) (gets?|tells|misses)\b/i, "faux-insight setup - make the claim stand alone"],
  [/\bthe part (everyone|most people) (misses|skips)\b/i, "faux-insight setup - make the claim stand alone"],
  [/\b(stands as a testament|marks a pivotal|plays a vital role|solidifies its|underscores its significance)\b/i, "importance puffery - state the fact"],
  [/\b(highlighting|underscoring|showcasing) (the|a|its|their)\b/i, "superficial -ing analysis - say the consequence"],
  [/\b(experts agree|studies show|industry reports suggest|widely regarded as)\b/i, "weasel attribution - name the source or cut it"],
  [/\bserves as a\b/i, "fake-strong verb - use is or has"],
  [/\bthe heart of the\b/i, "importance puffery - say what it does"],
  [/\bwhat if I told you\b|\bplot twist:/i, "rhetorical setup - make the point"],
  [/\bnever miss a\b/i, "marketing throat-clearing - say what it does"],
  [/[\u2014\u2013\u00b7\u2011]/, "em dash, en dash, middle dot or non-breaking hyphen - use a plain hyphen"],
];

function copyFiles(): string[] {
  const out = [...COPY_FILES];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = path.join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(p)) out.push(p);
    }
  };
  for (const r of COPY_ROOTS) walk(path.join(process.cwd(), r));
  return out.map((f) => (path.isAbsolute(f) ? f : path.join(process.cwd(), f)));
}

/**
 * The prose in a source file: quoted strings and JSX text.
 *
 * Import paths, class names and SVG path data are all quoted strings too, so
 * anything without two real words in it is not copy.
 */
function proseOf(source: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  /**
   * The copilot's own writing rules quote the patterns they ban, so the block
   * that defines them would fail this test forever. Skip that block only, from
   * its heading to the end of the prompt literal, and nothing else.
   */
  let inRuleBlock = false;
  source.split("\n").forEach((line, i) => {
    if (/# HOW YOU WRITE/.test(line)) inRuleBlock = true;
    else if (inRuleBlock && /`;\s*$/.test(line)) inRuleBlock = false;
    if (inRuleBlock) return;
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
    const candidates = [
      ...[...line.matchAll(/"((?:[^"\\]|\\.){12,})"/g)].map((m) => m[1]),
      ...[...line.matchAll(/`((?:[^`\\$]|\\.){12,})`/g)].map((m) => m[1]),
      ...[...line.matchAll(/>\s*([^<>{}\n]{12,})</g)].map((m) => m[1]),
    ];
    for (const c of candidates) {
      const text = c.trim();
      if (!/[a-z]{3,}\s+[a-z]{3,}/i.test(text)) continue;
      if (/^(https?:|\/|\.\/|@\/|M\d|[a-z-]+:[a-z-]+;)/.test(text)) continue;
      out.push({ line: i + 1, text });
    }
  });
  return out;
}

const findings = (() => {
  const hits: string[] = [];
  for (const file of copyFiles()) {
    const rel = path.relative(process.cwd(), file);
    for (const { line, text } of proseOf(readFileSync(file, "utf8"))) {
      const lower = text.toLowerCase();
      for (const w of BANNED) {
        if (new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(lower)) {
          hits.push(`${rel}:${line} banned word "${w}" - ${text.slice(0, 90)}`);
        }
      }
      for (const p of EMPTY_PHRASES) {
        if (lower.includes(p)) hits.push(`${rel}:${line} empty phrase "${p}" - ${text.slice(0, 90)}`);
      }
      for (const [re, why] of SHAPES) {
        if (re.test(text)) hits.push(`${rel}:${line} ${why} - ${text.slice(0, 90)}`);
      }
    }
  }
  return hits;
})();

describe("no ai slop in user-facing copy", () => {
  it("scans a meaningful amount of copy", () => {
    // A guard that silently stops finding files passes forever.
    const files = copyFiles();
    expect(files.length).toBeGreaterThan(60);
  });

  it("uses no banned marketing vocabulary and no empty phrases", () => {
    expect(findings, `\n${findings.join("\n")}\n`).toEqual([]);
  });
});
