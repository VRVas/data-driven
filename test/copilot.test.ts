import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { isPermissionKey, PERMISSIONS } from "@/lib/auth/catalogue";
import { COPILOT_TOOLS, getToolByName, toolSchemas } from "@/lib/copilot/tools";
import { isStructuredNotProse } from "@/lib/copilot/provider";
import { INTAKE_SPECS } from "@/lib/copilot/intake";

/**
 * Tools that existed and were deleted. Kept so the guard below can tell a
 * genuine dangling reference from an ordinary snake_case word in a sentence.
 */
const RETIRED = new Set(["add_comment", "list_comments", "delete_comment"]);

describe("copilot tool registry", () => {
  it("has unique, non-empty tool names", () => {
    const names = COPILOT_TOOLS.map((t) => t.name);
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((n) => n.length > 0)).toBe(true);
  });

  it("every tool has a description and an object parameter schema", () => {
    for (const t of COPILOT_TOOLS) {
      expect(t.description.length).toBeGreaterThan(10);
      expect((t.parameters as { type?: string }).type).toBe("object");
    }
  });

  it("resolves known tools and rejects unknown ones", () => {
    expect(getToolByName("pipeline_summary")?.name).toBe("pipeline_summary");
    expect(getToolByName("does_not_exist")).toBeUndefined();
  });

  it("flags mutating tools as writes", () => {
    expect(getToolByName("advance_lead_stage")?.write).toBe(true);
    expect(getToolByName("draft_outreach")?.write).toBe(true);
    expect(getToolByName("pipeline_summary")?.write).toBeFalsy();
    expect(getToolByName("search_leads")?.write).toBeFalsy();
  });

  it("emits function-calling schemas for the model", () => {
    const schemas = toolSchemas();
    expect(schemas).toHaveLength(COPILOT_TOOLS.length);
    expect(schemas.every((s) => s.type === "function" && !!s.function.name)).toBe(true);
    expect(schemas.some((s) => s.function.name === "draft_outreach")).toBe(true);
  });

  it("is described to users with the number of tools it actually has", () => {
    // The tour quotes the count in prose. Written by hand, it had already been
    // wrong twice and an E2E assertion was pinned to the stale figure.
    const steps = readFileSync(path.join(process.cwd(), "src/lib/tour/steps.ts"), "utf8");
    const quoted = [...steps.matchAll(/(\d+) tools/g)].map((m) => Number(m[1]));
    expect(quoted.length).toBeGreaterThan(0);
    // "went from 14 tools to 33" - the historical figure is allowed to stay,
    // the current one has to be right.
    expect(Math.max(...quoted)).toBe(COPILOT_TOOLS.length);
  });

  it("never points the model at a tool that does not exist", () => {
    // check_request's description told the model to call it before add_comment
    // for weeks after add_comment was deleted. A tool description is a prompt:
    // naming a tool that is not in the registry is an instruction to hallucinate
    // one. Every snake_case name in a description or an intake spec has to
    // resolve.
    const known = new Set(COPILOT_TOOLS.map((t) => t.name));
    const dangling: string[] = [];

    for (const tool of COPILOT_TOOLS) {
      for (const m of tool.description.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+){1,3})\b/g)) {
        const name = m[1];
        // Only complain about things that look like OUR tools: a name nobody
        // ever registered is just prose ("follow_up" in a sentence).
        if (!known.has(name) && RETIRED.has(name)) dangling.push(`${tool.name} names ${name}`);
      }
    }
    for (const spec of INTAKE_SPECS) {
      if (!known.has(spec.tool)) dangling.push(`intake spec for ${spec.tool}`);
    }

    expect(dangling, `\n${dangling.join("\n")}\n`).toEqual([]);
  });

  it("quotes the real number of permissions everywhere it quotes one", () => {
    // Same failure as the tool count, one file over: three separate prose
    // copies of "44 permissions" outlived the catalogue reaching 47. A number
    // written by hand in four places is a number that is wrong in at least one.
    //
    // This originally listed the files to check, and that list went stale the
    // moment the tour started quoting the number too - it sat at 44 for weeks
    // because no test was looking there. So find the claims instead of naming
    // the files that make them.
    const roots = ["src", "infra", "scripts"];
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) {
          if (entry !== "node_modules") walk(p);
          continue;
        }
        if (!/\.(ts|tsx|bicep|sh|md|json)$/.test(p)) continue;
        const text = readFileSync(p, "utf8");
        for (const m of text.matchAll(/(\d+) (?:separate |distinct )?permissions/g)) {
          found.push(`${path.relative(process.cwd(), p)} says ${m[1]}`);
          expect(Number(m[1]), `${path.relative(process.cwd(), p)} is stale`).toBe(
            PERMISSIONS.length,
          );
        }
      }
    };
    for (const r of roots) walk(path.join(process.cwd(), r));
    expect(found.length, "nothing quotes a permission count any more").toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------
// The chat is a second way into the same data as the screens
// ---------------------------------------------------------------------------

describe("copilot tools are gated", () => {
  it("declares a catalogued permission on every tool", () => {
    // Four tools once took a lead id and checked nothing, so the chat could
    // read and even mutate records the UI refuses. The gate is declarative now
    // and enforced centrally, so a new tool cannot forget it.
    for (const t of COPILOT_TOOLS) {
      expect(t.permission, `${t.name} declares no permission`).toBeTruthy();
      expect(isPermissionKey(t.permission!), `${t.name}: ${t.permission} is not in the catalogue`).toBe(true);
    }
  });

  it("never gates a write tool behind a read permission", () => {
    for (const t of COPILOT_TOOLS.filter((x) => x.write)) {
      expect(t.permission!.endsWith(":read"), `${t.name} is a write gated by ${t.permission}`).toBe(false);
    }
  });

  it("has at least one write tool, so the check above is not vacuous", () => {
    expect(COPILOT_TOOLS.some((t) => t.write)).toBe(true);
  });

  it("cannot read a lead without going through the scoped accessor", () => {
    // getBrand() is the raw store read. Importing it here is what made the
    // record scope skippable; the scoped helpers live in leads/visible.
    const source = readFileSync(path.join(process.cwd(), "src/lib/copilot/tools.ts"), "utf8");
    const imports = source.slice(0, source.indexOf("export interface ToolContext"));
    expect(imports).not.toMatch(/\bgetBrand\b/);
    expect(imports).toMatch(/visibleLead/);
    expect(imports).toMatch(/writableLead/);
  });
});

// ---------------------------------------------------------------------------
// A reply that is not prose must never be printed at a person
// ---------------------------------------------------------------------------

describe("structured output that is not an answer", () => {
  it("recognises the schema echoed back", () => {
    // The real failure, verified against the deployed model: under a
    // json_schema response format it occasionally returns the SCHEMA instead
    // of an instance, and that was rendered into the chat as a text block.
    const echoed = JSON.stringify({
      type: "object",
      properties: { blocks: { type: "array", items: { type: "object", description: "One UI block." } } },
    });
    expect(isStructuredNotProse(echoed)).toBe(true);
  });

  it("recognises any other machine artefact", () => {
    expect(isStructuredNotProse('{"blocks":[]}')).toBe(true);
    expect(isStructuredNotProse("  [1,2,3] ")).toBe(true);
  });

  it("leaves real prose alone", () => {
    // A plain-text answer is still worth showing, so this must not swallow it.
    expect(isStructuredNotProse("Alibaba ranks 59 because its budget is confirmed.")).toBe(false);
    expect(isStructuredNotProse("")).toBe(false);
    expect(isStructuredNotProse("{ this is not json")).toBe(false);
    expect(isStructuredNotProse("The result is {a: 1} roughly")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The notes thread is reachable
// ---------------------------------------------------------------------------

describe("notes are part of the record the copilot can reach", () => {
  it("offers both halves: the opening note and the thread", () => {
    // update_lead writes the initial note. Without append_note the model's only
    // way to record what a client said is to overwrite that note, which
    // destroys whatever somebody else put there.
    const names = new Set(COPILOT_TOOLS.map((t) => t.name));
    expect(names.has("append_note"), "no way to add to a lead's notes").toBe(true);
    expect(names.has("read_notes"), "no way to read a lead's notes thread").toBe(true);
  });

  it("appending a note is a write, and reading one is not", () => {
    expect(getToolByName("append_note")?.write).toBe(true);
    expect(getToolByName("read_notes")?.write).toBeFalsy();
  });

  it("free-text search says it covers the thread", () => {
    // A note nobody can find is half a feature, and the description is what
    // tells the model the search is worth trying for "what did we say about X".
    const q = getToolByName("search_leads")?.parameters as
      | { properties?: { query?: { description?: string } } }
      | undefined;
    expect(q?.properties?.query?.description ?? "").toMatch(/thread/i);
  });
});

// ---------------------------------------------------------------------------
// The tour describes the app that exists
// ---------------------------------------------------------------------------

describe("product tour", () => {
  const steps = () => {
    const src = readFileSync(path.join(process.cwd(), "src/lib/tour/steps.ts"), "utf8");
    return src;
  };

  it("cites one version, the one on the badge", () => {
    // Every `isNew` step renders TOUR_NEW_BADGE. Two bodies still said v1.1
    // after the badge moved to v1.2, so the walkthrough badged things "new in
    // v1.2" and then closed by summarising v1.1.
    const src = steps();
    const badge = src.match(/TOUR_NEW_BADGE = "New in (v\d+\.\d+)"/)?.[1];
    expect(badge, "TOUR_NEW_BADGE changed shape").toBeTruthy();
    const cited = new Set([...src.matchAll(/\bv\d+\.\d+\b/g)].map((m) => m[0]));
    cited.delete(badge!);
    expect([...cited], `the tour cites versions other than ${badge}`).toEqual([]);
  });

  it("uses the current vocabulary, not the one it replaced", () => {
    // The tour is 36 steps of prose about the app. A rename that misses it
    // leaves a walkthrough teaching people words the UI no longer uses.
    const src = steps();
    for (const retired of [
      "Deal Closed",
      "Did not work out",
      "Back to Attack",
      "Still to open",
      "Hot Lead",
      "Warm Lead",
      "Cold Lead",
    ]) {
      expect(src.includes(retired), `the tour still says "${retired}"`).toBe(false);
    }
  });
});
