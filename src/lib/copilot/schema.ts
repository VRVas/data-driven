/**
 * JSON Schema for the Foundry structured-output response. It guides the model to
 * emit the block protocol; `parseBlocks` (zod) is the authoritative validator, so
 * this stays lenient (`strict:false`) to tolerate a hand-authored schema.
 *
 * Docs: https://learn.microsoft.com/azure/ai-foundry/openai/how-to/structured-outputs
 */
export function blocksResponseSchema() {
  const block = {
    type: "object",
    description:
      "One UI block. `type` selects the block; fill only that block's fields. " +
      "heading{eyebrow?,title,subtitle?} · text{text} · callout{tone(insight|success|warning|danger),title?,text} · " +
      "metrics{items:[{label,value,unit?,delta?,tone?}]} · table{columns:[{key,label,align?,kind?}],rows:[{}]} · " +
      "chart{variant(bar|donut|scatter|line|progress),title?,series?:[{label,value,tone?}],points?:[{x,y,label?,size?,tone?}],max?} · " +
      "leadCard/leadGrid{leads:[{id,name,status?,score?,budgetEur?,quadrant?}]} · " +
      "recommendation{title,rationale,confidence?} · list{style,items} · timeline{events:[{date?,label,done?}]} · " +
      "sources{title?,items:[{n?,title,url}]} · " +
      "actions{actions:[{label,tool,args?,style?}]}",
    properties: {
      type: {
        type: "string",
        enum: [
          "heading", "text", "reasoning", "callout", "divider", "metrics", "table",
          "keyValue", "list", "badges", "chart", "leadCard", "leadGrid",
          "comparison", "recommendation", "timeline", "actions", "sources",
        ],
      },
      title: { type: "string" },
      subtitle: { type: "string" },
      eyebrow: { type: "string" },
      text: { type: "string" },
      tone: { type: "string" },
      variant: { type: "string", enum: ["bar", "donut", "scatter", "line", "progress"] },
      items: { type: "array" },
      columns: { type: "array" },
      rows: { type: "array" },
      series: { type: "array" },
      points: { type: "array" },
      leads: { type: "array" },
      actions: { type: "array" },
      events: { type: "array" },
      style: { type: "string" },
      max: { type: "number" },
      rationale: { type: "string" },
      confidence: { type: "number" },
      id: { type: "string" },
      name: { type: "string" },
      status: { type: "string" },
      priority: { type: "string" },
      industry: { type: "string" },
      score: { type: "number" },
      budgetEur: { type: "number" },
      quadrant: { type: "string" },
    },
    required: ["type"],
    additionalProperties: true,
  } as const;

  return {
    name: "copilot_blocks",
    strict: false,
    schema: {
      type: "object",
      properties: { blocks: { type: "array", items: block } },
      required: ["blocks"],
      additionalProperties: false,
    },
  };
}
