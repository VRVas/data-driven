import { z } from "zod";

/**
 * The generative-UI block protocol.
 *
 * The copilot composes a response as an ordered array of typed blocks. The
 * frontend renders each block with a Midnight-themed component - no HTML, no
 * iframes, no Plotly. The same schema drives (a) the local preview provider,
 * (b) runtime validation of model output, and (c) the Foundry structured-output
 * JSON schema. Anything that fails validation is dropped, so a malformed block
 * never breaks the render.
 */

export const TONES = ["neutral", "brand", "cyan", "mint", "amber", "rose", "violet"] as const;
export type Tone = (typeof TONES)[number];

/** Map a tone (or a callout tone) to a design-system colour variable. */
export const TONE_VAR: Record<string, string> = {
  neutral: "var(--color-ink-muted)",
  brand: "var(--color-brand)",
  violet: "var(--color-brand)",
  cyan: "var(--color-cyan)",
  mint: "var(--color-mint)",
  amber: "var(--color-amber)",
  rose: "var(--color-rose)",
  insight: "var(--color-brand)",
  success: "var(--color-mint)",
  warning: "var(--color-amber)",
  danger: "var(--color-rose)",
};
export const toneVar = (t?: string | null): string => TONE_VAR[t ?? "neutral"] ?? "var(--color-ink-muted)";

const tone = z.enum(TONES);
const numOrStr = z.union([z.string(), z.number()]);

// --- Lead shape (reused by leadCard + leadGrid) ---------------------------
const leadShape = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string().nullish(),
  priority: z.string().nullish(),
  industry: z.string().nullish(),
  score: z.number().nullish(),
  budgetEur: z.number().nullish(),
  quadrant: z.string().nullish(),
  winProbability: z.number().nullish(),
});
export type LeadCardData = z.infer<typeof leadShape>;

/** A client relationship, which is a different shape from a single engagement. */
const companyShape = z.object({
  id: z.string(),
  name: z.string(),
  industry: z.string().nullish(),
  owner: z.string().nullish(),
  openDealCount: z.number().nullish(),
  wonDealCount: z.number().nullish(),
  openPipelineEur: z.number().nullish(),
  lifetimeValueEur: z.number().nullish(),
  /** Won beyond the first deal - the number that shows a relationship compounding. */
  repeatValueEur: z.number().nullish(),
  dealWinRate: z.number().nullish(),
  lastContact: z.string().nullish(),
});
export type CompanyCardData = z.infer<typeof companyShape>;

// --- Block variants -------------------------------------------------------
const headingBlock = z.object({
  type: z.literal("heading"),
  eyebrow: z.string().nullish(),
  title: z.string(),
  subtitle: z.string().nullish(),
});

const textBlock = z.object({
  type: z.literal("text"),
  text: z.string(), // light markdown: **bold**, `- ` bullets
});

const reasoningBlock = z.object({
  type: z.literal("reasoning"),
  text: z.string(),
});

const calloutBlock = z.object({
  type: z.literal("callout"),
  tone: z.enum(["insight", "success", "warning", "danger"]).default("insight"),
  title: z.string().nullish(),
  text: z.string(),
});

const dividerBlock = z.object({ type: z.literal("divider") });

const metricsBlock = z.object({
  type: z.literal("metrics"),
  items: z
    .array(
      z.object({
        label: z.string(),
        value: numOrStr,
        unit: z.string().nullish(),
        delta: z.number().nullish(),
        tone: tone.nullish(),
      }),
    )
    .max(8),
});

const tableBlock = z.object({
  type: z.literal("table"),
  caption: z.string().nullish(),
  columns: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      align: z.enum(["left", "right", "center"]).nullish(),
      kind: z.enum(["text", "number", "currency", "percent", "status", "badge"]).nullish(),
    }),
  ),
  rows: z.array(z.record(z.union([z.string(), z.number(), z.null()]))),
});

const keyValueBlock = z.object({
  type: z.literal("keyValue"),
  items: z.array(z.object({ label: z.string(), value: numOrStr })),
});

const listBlock = z.object({
  type: z.literal("list"),
  style: z.enum(["bullet", "ordered", "check"]).default("bullet"),
  items: z.array(z.string()),
});

const badgesBlock = z.object({
  type: z.literal("badges"),
  items: z.array(z.object({ label: z.string(), tone: tone.nullish() })),
});

const chartBlock = z.object({
  type: z.literal("chart"),
  variant: z.enum(["bar", "donut", "scatter", "line", "progress"]),
  title: z.string().nullish(),
  xLabel: z.string().nullish(),
  yLabel: z.string().nullish(),
  max: z.number().nullish(),
  series: z
    .array(z.object({ label: z.string(), value: z.number(), tone: tone.nullish() }))
    .nullish(),
  points: z
    .array(
      z.object({
        x: z.number(),
        y: z.number(),
        label: z.string().nullish(),
        size: z.number().nullish(),
        tone: tone.nullish(),
      }),
    )
    .nullish(),
});

const leadCardBlock = leadShape.extend({ type: z.literal("leadCard") });

const leadGridBlock = z.object({
  type: z.literal("leadGrid"),
  leads: z.array(leadShape).max(9),
});

const companyCardBlock = companyShape.extend({ type: z.literal("companyCard") });

/**
 * Why a lead ranks where it does.
 *
 * Priority is a geometric mean of two axes with a third deliberately left out,
 * which a bare number cannot convey - and "we need to understand how the
 * scoring works" was the original complaint.
 */
const scoreBreakdownBlock = z.object({
  type: z.literal("scoreBreakdown"),
  id: z.string().nullish(),
  name: z.string(),
  priority: z.number(),
  grade: z.string().nullish(),
  quadrant: z.string().nullish(),
  opportunity: z.number(),
  winnability: z.number(),
  /** Reported beside the axes, never folded into the score. */
  ease: z.number().nullish(),
  expectedValueEur: z.number().nullish(),
  drivers: z.array(z.object({ label: z.string(), detail: z.string() })).max(6).nullish(),
});

const comparisonBlock = z.object({
  type: z.literal("comparison"),
  items: z
    .array(
      z.object({
        title: z.string(),
        subtitle: z.string().nullish(),
        tone: tone.nullish(),
        metrics: z.array(z.object({ label: z.string(), value: numOrStr })),
      }),
    )
    .max(3),
});

const recommendationBlock = z.object({
  type: z.literal("recommendation"),
  title: z.string(),
  rationale: z.string(),
  confidence: z.number().min(0).max(1).nullish(),
});

const timelineBlock = z.object({
  type: z.literal("timeline"),
  events: z.array(z.object({ date: z.string().nullish(), label: z.string(), done: z.boolean().nullish() })),
});

const actionBlock = z.object({
  type: z.literal("actions"),
  actions: z
    .array(
      z.object({
        label: z.string(),
        tool: z.string(),
        args: z.record(z.unknown()).nullish(),
        style: z.enum(["primary", "ghost"]).nullish(),
        confirm: z.string().nullish(),
      }),
    )
    .max(4),
});

// Cited web/document sources - clickable external links (used by web grounding).
const sourcesBlock = z.object({
  type: z.literal("sources"),
  title: z.string().nullish(),
  items: z
    .array(z.object({ n: z.number().nullish(), title: z.string(), url: z.string() }))
    .min(1)
    .max(12),
});

export const BlockSchema = z.discriminatedUnion("type", [
  headingBlock,
  textBlock,
  reasoningBlock,
  calloutBlock,
  dividerBlock,
  metricsBlock,
  tableBlock,
  keyValueBlock,
  listBlock,
  badgesBlock,
  chartBlock,
  leadCardBlock,
  leadGridBlock,
  companyCardBlock,
  scoreBreakdownBlock,
  comparisonBlock,
  recommendationBlock,
  timelineBlock,
  actionBlock,
  sourcesBlock,
]);

export type Block = z.infer<typeof BlockSchema>;
export type BlockType = Block["type"];
export type ActionSpec = z.infer<typeof actionBlock>["actions"][number];

/** Read/write a nested array by the path zod reports on an issue. */
function atPath(root: unknown, path: (string | number)[]): unknown {
  return path.reduce<unknown>((node, key) => (node == null ? node : (node as Record<string, unknown>)[key]), root);
}

/**
 * Salvage a block the schema rejected.
 *
 * The per-block caps exist so one answer cannot flood the panel, but rejecting
 * the whole block for breaching them threw away everything the model wrote:
 * ten metrics produced no metrics at all, five suggested actions produced no
 * buttons. Trimming to the cap keeps the answer; dropping it silently is what
 * made replies look truncated for no visible reason.
 */
function repairBlock(raw: unknown, error: z.ZodError): Block | null {
  if (raw == null || typeof raw !== "object") return null;

  const oversized = error.issues.filter(
    (i): i is z.ZodIssue & { maximum: number | bigint } =>
      i.code === "too_big" && "type" in i && (i as { type?: unknown }).type === "array",
  );
  if (oversized.length > 0) {
    const clone = structuredClone(raw) as Record<string, unknown>;
    for (const issue of oversized) {
      const parent = issue.path.slice(0, -1);
      const key = issue.path.at(-1)!;
      const holder = (parent.length ? atPath(clone, parent) : clone) as Record<string | number, unknown>;
      const list = holder?.[key];
      if (Array.isArray(list)) holder[key] = list.slice(0, Number(issue.maximum));
    }
    const retry = BlockSchema.safeParse(clone);
    if (retry.success) return retry.data;
  }

  // Last resort: a block we cannot render but which carries prose is still
  // worth more to the reader than nothing.
  const text = (raw as { text?: unknown }).text;
  return typeof text === "string" && text.trim() ? { type: "text", text } : null;
}

/** Validate + filter unknown input into a clean list of blocks (never throws). */
export function parseBlocks(input: unknown): Block[] {
  const arr = Array.isArray(input)
    ? input
    : input && typeof input === "object" && Array.isArray((input as { blocks?: unknown }).blocks)
      ? (input as { blocks: unknown[] }).blocks
      : [];
  const out: Block[] = [];
  for (const raw of arr) {
    const parsed = BlockSchema.safeParse(raw);
    if (parsed.success) {
      out.push(parsed.data);
      continue;
    }
    const salvaged = repairBlock(raw, parsed.error);
    if (salvaged) out.push(salvaged);
  }
  return out;
}

/** Convenience builders for the local provider - keeps composition terse + typed. */
export const b = {
  heading: (title: string, opts: { eyebrow?: string; subtitle?: string } = {}): Block => ({
    type: "heading",
    title,
    eyebrow: opts.eyebrow ?? null,
    subtitle: opts.subtitle ?? null,
  }),
  text: (text: string): Block => ({ type: "text", text }),
  reasoning: (text: string): Block => ({ type: "reasoning", text }),
  callout: (text: string, tone: "insight" | "success" | "warning" | "danger" = "insight", title?: string): Block => ({
    type: "callout",
    tone,
    title: title ?? null,
    text,
  }),
  divider: (): Block => ({ type: "divider" }),
  metrics: (items: z.infer<typeof metricsBlock>["items"]): Block => ({ type: "metrics", items }),
  table: (
    columns: z.infer<typeof tableBlock>["columns"],
    rows: z.infer<typeof tableBlock>["rows"],
    caption?: string,
  ): Block => ({ type: "table", columns, rows, caption: caption ?? null }),
  list: (items: string[], style: "bullet" | "ordered" | "check" = "bullet"): Block => ({ type: "list", style, items }),
  keyValue: (items: z.infer<typeof keyValueBlock>["items"]): Block => ({ type: "keyValue", items }),
  badges: (items: { label: string; tone?: Tone | null }[]): Block => ({ type: "badges", items }),
  chart: (variant: z.infer<typeof chartBlock>["variant"], data: Partial<z.infer<typeof chartBlock>>): Block => ({
    type: "chart",
    variant,
    title: data.title ?? null,
    xLabel: data.xLabel ?? null,
    yLabel: data.yLabel ?? null,
    max: data.max ?? null,
    series: data.series ?? null,
    points: data.points ?? null,
  }),
  leadCard: (lead: LeadCardData): Block => ({ type: "leadCard", ...lead }),
  leadGrid: (leads: LeadCardData[]): Block => ({ type: "leadGrid", leads }),
  companyCard: (company: CompanyCardData): Block => ({ type: "companyCard", ...company }),
  scoreBreakdown: (input: Omit<Extract<Block, { type: "scoreBreakdown" }>, "type">): Block => ({
    type: "scoreBreakdown",
    ...input,
  }),
  comparison: (items: z.infer<typeof comparisonBlock>["items"]): Block => ({ type: "comparison", items }),
  recommendation: (title: string, rationale: string, confidence?: number): Block => ({
    type: "recommendation",
    title,
    rationale,
    confidence: confidence ?? null,
  }),
  timeline: (events: z.infer<typeof timelineBlock>["events"]): Block => ({ type: "timeline", events }),
  actions: (actions: ActionSpec[]): Block => ({ type: "actions", actions }),
  sources: (items: { n?: number; title: string; url: string }[], title?: string): Block => ({
    type: "sources",
    title: title ?? null,
    items: items.map((s) => ({ n: s.n ?? null, title: s.title, url: s.url })),
  }),
};
