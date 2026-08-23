import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Typographic characters we do not use.
 *
 * A standing instruction, and the kind that decays the moment nobody is
 * looking: an em dash arrives every time someone pastes from a document or a
 * model writes one. There is no ESLint config in this project, so the check
 * lives here.
 */
const BANNED: Record<string, string> = {
  "\u2014": "em dash - write a plain hyphen",
  "\u2013": "en dash - write a plain hyphen",
  "\u00b7": "middle dot - write a hyphen, a comma, or nothing",
  "\u2011": "non-breaking hyphen - write a plain hyphen",
};

const ROOTS = ["src", "e2e", "test", "scripts", "infra", "docs"];
const EXTENSIONS = new Set([".ts", ".tsx", ".css", ".md", ".sh", ".bicep", ".yml", ".yaml", ".json", ".mjs"]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (EXTENSIONS.has(path.extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

describe("house typography", () => {
  it("uses plain hyphens and no middle dots", () => {
    const offences: string[] = [];

    for (const root of ROOTS) {
      for (const file of sourceFiles(path.join(process.cwd(), root))) {
        const lines = readFileSync(file, "utf8").split("\n");
        lines.forEach((line, i) => {
          for (const [char, why] of Object.entries(BANNED)) {
            if (line.includes(char)) {
              offences.push(`${path.relative(process.cwd(), file)}:${i + 1} ${why}`);
            }
          }
        });
      }
    }

    expect(offences).toEqual([]);
  });
});
