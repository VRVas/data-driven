import { economicalEfficiency, easeOfAccess } from "@/lib/scoring";
import type { Brand, BrandScores } from "@/lib/types";

/**
 * A score record for a lead nobody has run through the rubric.
 *
 * Every judgement is null because none has been made; only the industry is
 * known, and it is copied rather than guessed.
 */
export function blankScores(brand: Brand): BrandScores {
  return {
    tempoMonths: null,
    tempoScore: null,
    closing: null,
    process: null,
    dealsClosed: null,
    budget: null,
    assumption: null,
    budgetScore: null,
    customizationScore: null,
    accessibilityRaw: null,
    accessibilityScore: null,
    receptivityScore: null,
    alignmentScore: null,
    industry: brand.industry ?? "Other",
    economicalEfficiency: null,
    easeOfAccess: null,
  };
}

/** The four judgements a person makes about a lead, each 0-5. */
export interface Rubric {
  customizationScore: number | null;
  accessibilityScore: number | null;
  receptivityScore: number | null;
  alignmentScore: number | null;
}

export const RUBRIC_FIELDS = [
  {
    key: "customizationScore",
    label: "Customization",
    help: "How much bespoke work it needs. Higher is cheaper for us to deliver.",
  },
  {
    key: "accessibilityScore",
    label: "Accessibility",
    help: "How easily we reach the people who decide.",
  },
  {
    key: "receptivityScore",
    label: "Receptivity",
    help: "How warmly they engage when we do reach them.",
  },
  {
    key: "alignmentScore",
    label: "Alignment",
    help: "How well the brand fits what we make.",
  },
] as const satisfies readonly { key: keyof Rubric; label: string; help: string }[];

/**
 * Record the human judgements behind a lead's score.
 *
 * These were imported once and then unreachable: the breakdown on the lead page
 * could show accessibility and receptivity but nothing could change them, even
 * though both feed winnability directly. A lead created in the app had no way
 * to acquire them at all.
 *
 * Returns the same object when nothing moved, so callers can save
 * unconditionally.
 */
export function writeRubric(brand: Brand, values: Rubric): Brand {
  const s = brand.scores;
  const stated = Object.values(values).some((v) => v != null);
  if (!s && !stated) return brand;

  const base = s ?? blankScores(brand);
  if (s && RUBRIC_FIELDS.every(({ key }) => s[key] === values[key])) return brand;

  const scores: BrandScores = { ...base, ...values };
  scores.economicalEfficiency = economicalEfficiency(scores) ?? base.economicalEfficiency;
  scores.easeOfAccess = easeOfAccess(scores) ?? base.easeOfAccess;

  return { ...brand, scored: brand.scored || stated, scores };
}
