import { describe, it, expect } from "vitest";
import { platformSpec } from "@/lib/copilot/platform-spec";
import { COPILOT_TOOLS } from "@/lib/copilot/tools";
import { PERMISSIONS } from "@/lib/auth/catalogue";
import { SYSTEM_PROFILES } from "@/lib/auth/profiles";
import { STATUS_FLOW } from "@/lib/workflow";

const spec = () =>
  platformSpec(
    COPILOT_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      permission: t.permission,
      write: t.write,
    })),
  );

describe("platformSpec", () => {
  it("reports the copilot's real capabilities, not a remembered list", () => {
    // The whole point of deriving it: "what can you do?" has to stay true as
    // tools are added, and prose does not.
    const s = spec();
    expect(s.copilot.toolCount).toBe(COPILOT_TOOLS.length);
    expect(s.copilot.tools.map((t) => t.name).sort()).toEqual(COPILOT_TOOLS.map((t) => t.name).sort());
    expect(s.copilot.writeToolCount).toBe(COPILOT_TOOLS.filter((t) => t.write).length);
  });

  it("says what each tool needs, so a refusal can be explained", () => {
    const s = spec();
    // Most refusals are "not for you", not "not supported", and the two need
    // different answers.
    for (const tool of s.copilot.tools) {
      expect(tool.needs).toBeTruthy();
    }
    expect(s.copilot.tools.find((t) => t.name === "delete_lead")).toMatchObject({
      needs: "lead:delete",
      writes: true,
    });
  });

  it("carries the whole permission catalogue and the seeded profiles", () => {
    const s = spec();
    expect(s.permissions.catalogue).toHaveLength(PERMISSIONS.length);
    expect(s.permissions.profiles.map((p) => p.id).sort()).toEqual(SYSTEM_PROFILES.map((p) => p.id).sort());
    expect(s.permissions.catalogue.find((p) => p.key === "company:merge")?.risk).toBe("high");
  });

  it("describes the stage graph the app actually enforces", () => {
    expect(spec().dataModel.stageFlow.allowed).toEqual(STATUS_FLOW);
  });

  it("gives a route for every section it lists", () => {
    for (const section of spec().sections) {
      expect(section.route).toMatch(/^\/dashboard/);
      expect(section.name.length).toBeGreaterThan(0);
    }
  });

  it("answers the questions that were actually asked of the product", () => {
    const how = spec().howDoI;
    expect(how["delete a lead"]).toMatch(/lead:delete/);
    expect(how["merge two companies that are the same client"]).toMatch(/company:merge/);
    expect(how["add a second deal for a client we already have"]).toMatch(/New deal/);
  });

  it("narrows to one topic without losing what the platform is", () => {
    const s = spec();
    expect(Object.keys({ what: s.what, sections: s.sections })).toEqual(["what", "sections"]);
  });
});
