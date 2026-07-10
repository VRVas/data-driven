import { describe, it, expect } from "vitest";
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
});
