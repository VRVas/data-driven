import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isPermissionKey } from "@/lib/auth/catalogue";
import { COPILOT_TOOLS, getToolByName, toolSchemas } from "@/lib/copilot/tools";

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
