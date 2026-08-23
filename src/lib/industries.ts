import type { Brand, Industry, IndustryStat } from "./types";
import { effectiveScores } from "./scoring";

const mean = (values: (number | null | undefined)[]): number | null => {
  const known = values.filter((v): v is number => v != null);
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0) / known.length;
};

const round = (v: number | null, dp: number): number | null =>
  v == null ? null : Number(v.toFixed(dp));

/**
 * Industry rows recounted from the live pipeline.
 *
 * Market size, music-video fit and valuation are external research and stay
 * exactly as imported. Everything that describes *our* pipeline - how many
 * leads we have opened, what they are worth, how they score - is counted from
 * the leads themselves.
 *
 * It used to come from the import snapshot, which meant the numbers were true
 * on the day of the export and never again: adding Finance leads left the
 * Finance count, its average budget and the whitespace ranking all sitting on
 * figures from the original spreadsheet.
 *
 * A lead with no industry is left out rather than filed under "Other", because
 * not knowing is not the same as knowing it is something else.
 */
export function liveIndustries(reference: IndustryStat[], brands: Brand[]): IndustryStat[] {
  const byName = new Map(reference.map((r) => [r.name, r]));

  const leadsByIndustry = new Map<Industry, Brand[]>();
  for (const b of brands) {
    if (!b.industry) continue;
    const list = leadsByIndustry.get(b.industry);
    if (list) list.push(b);
    else leadsByIndustry.set(b.industry, [b]);
  }

  const names = new Set<Industry>([...byName.keys(), ...leadsByIndustry.keys()]);

  return [...names].map((name) => {
    const ref = byName.get(name);
    const leads = leadsByIndustry.get(name) ?? [];
    const scores = leads.map((b) => effectiveScores(b));

    const opened = leads.length;
    const companiesEU = ref?.companiesEU ?? null;
    const budgets = scores.map((s) => s?.budget).filter((v): v is number => v != null);

    return {
      name,
      opened,
      companiesEU,
      approachedMarket: companiesEU ? round(opened / companiesEU, 4) : null,
      economicalEfficiency: round(mean(scores.map((s) => s?.economicalEfficiency)), 4),
      easeOfAccess: round(mean(scores.map((s) => s?.easeOfAccess)), 4),
      // Averaged over the leads that actually carry a figure. Dividing by every
      // lead in the segment reported a segment as cheaper the less it was known
      // about.
      avgBudget: budgets.length === 0 ? null : Math.round(budgets.reduce((a, b) => a + b, 0) / budgets.length),
      musicVideoFit: ref?.musicVideoFit ?? null,
      valuation: ref?.valuation ?? null,
    };
  });
}
