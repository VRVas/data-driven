import { describe, it, expect, afterEach } from "vitest";
import { EFFORT_NORMAL, deepEffort, effortFor, copilotModel } from "@/lib/copilot/provider";

/**
 * "Think deeply" is one model at two efforts, not two models. These pin the
 * contract because getting it wrong is invisible: the wrong effort still
 * returns a perfectly plausible answer.
 */

const reset = () => {
  delete process.env.COPILOT_REASONING_EFFORT;
  delete process.env.COPILOT_MODEL;
};
afterEach(reset);

describe("reasoning effort", () => {
  it("spends little on an ordinary ask", () => {
    expect(effortFor(false)).toBe("low");
    expect(effortFor(undefined)).toBe("low");
  });

  it("never uses minimal, which would disable parallel tool calls", () => {
    // The copilot is a tool-calling loop; minimal would quietly cripple it.
    expect(EFFORT_NORMAL).not.toBe("minimal");
  });

  it("spends more when the user asks it to think", () => {
    expect(effortFor(true)).toBe("high");
  });

  it("takes the deep setting from one environment variable", () => {
    process.env.COPILOT_REASONING_EFFORT = "medium";
    expect(deepEffort()).toBe("medium");
    expect(effortFor(true)).toBe("medium");
    // The ordinary path is unaffected by it.
    expect(effortFor(false)).toBe("low");
  });

  it("ignores a value the API would reject rather than forwarding a typo", () => {
    process.env.COPILOT_REASONING_EFFORT = "very-high";
    expect(deepEffort()).toBe("high");
  });

  it("accepts the documented values, case and padding included", () => {
    for (const v of ["none", "minimal", "low", "medium", "high", "xhigh", "max"]) {
      process.env.COPILOT_REASONING_EFFORT = ` ${v.toUpperCase()} `;
      expect(deepEffort()).toBe(v);
    }
  });
});

describe("model", () => {
  it("is gpt-5.4-mini unless overridden", () => {
    expect(copilotModel()).toBe("gpt-5.4-mini");
    process.env.COPILOT_MODEL = "gpt-5.4";
    expect(copilotModel()).toBe("gpt-5.4");
  });

  it("does not change when thinking deeply", () => {
    process.env.COPILOT_MODEL = "gpt-5.4-mini";
    const before = copilotModel();
    process.env.COPILOT_REASONING_EFFORT = "high";
    expect(copilotModel()).toBe(before);
  });
});
