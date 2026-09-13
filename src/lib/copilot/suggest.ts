import type { Brand } from "@/lib/types";
import { openLeads, outcomeOf } from "@/lib/lifecycle";
import { effectiveTempoMonths } from "@/lib/scoring";

/**
 * Educated guesses for the fields of a new lead, drawn from the CRM itself.
 *
 * The rule this module exists to enforce: a suggestion must carry its
 * evidence. "About 45k" is a number somebody has to take on faith; "the median
 * of the 11 live Fashion leads is 45k, quartiles 30k to 60k" is a number they
 * can disagree with. Every suggestion therefore ships a basis and a sample
 * size, and anything the pipeline genuinely cannot answer is returned as a
 * research gap rather than invented - that is the honest hand-off to the web.
 *
 * Pure: it is given the brands rather than fetching them, so it can be tested
 * against a fixture instead of a database.
 */

export type Confidence = "high" | "medium" | "low";

export interface FieldSuggestion {
  field: string;
  value: string | number;
  /** The value as it should be read aloud. */
  label: string;
  confidence: Confidence;
  basis: string;
  sampleSize: number;
}

export interface ResearchGap {
  field: string;
  why: string;
  /** A query to put to web_search, already phrased. */
  suggestedQuery: string;
}

export interface SuggestionResult {
  for: string;
  suggestions: FieldSuggestion[];
  researchGaps: ResearchGap[];
  /** Existing leads whose name is close enough to be the same client. */
  possibleDuplicates: { id: string; name: string; status: string | null; owner: string | null }[];
  note: string;
}

export interface LeadDraft {
  name?: string | null;
  industry?: string | null;
  owner?: string | null;
  valueEur?: number | null;
  status?: string | null;
  priority?: string | null;
  expectedMonths?: number | null;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(s\.?p\.?a\.?|s\.?r\.?l\.?|group|holding|italia|italy|international|global|inc|ltd|llc|gmbh|sa|nv|bv)\b/g, "")
    .replace(/[^a-z0-9]/g, "");

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
}

const eur = (n: number) => `€${Math.round(n).toLocaleString("en-IE")}`;

/** Enough of a sample to be worth quoting, and enough to be worth trusting. */
function confidenceFor(n: number): Confidence {
  if (n >= 8) return "high";
  if (n >= 4) return "medium";
  return "low";
}

export function suggestLeadFields(brands: Brand[], draft: LeadDraft = {}): SuggestionResult {
  const suggestions: FieldSuggestion[] = [];
  const researchGaps: ResearchGap[] = [];
  const name = draft.name?.trim() ?? "";

  // Same client, already in the pipeline? Worth saying before anything else -
  // a second record for one client splits its history in half.
  const key = name ? norm(name) : "";
  const possibleDuplicates = !key
    ? []
    : brands
        .filter((b) => {
          const other = norm(b.name);
          return other === key || (other.length > 3 && key.length > 3 && (other.includes(key) || key.includes(other)));
        })
        .slice(0, 5)
        .map((b) => ({ id: b.id, name: b.name, status: b.status, owner: b.owner }));

  // Industry: only inferable from a record we already hold for this client.
  // Anything else is a guess about the outside world, which is the web's job.
  let industry = draft.industry ?? null;
  if (!industry) {
    const twin = possibleDuplicates
      .map((d) => brands.find((b) => b.id === d.id))
      .find((b): b is Brand => !!b?.industry);
    if (twin?.industry) {
      industry = twin.industry;
      suggestions.push({
        field: "industry",
        value: twin.industry,
        label: twin.industry,
        confidence: "medium",
        basis: `We already hold ${twin.name} as ${twin.industry}, and the names match closely enough to be the same client.`,
        sampleSize: 1,
      });
    } else {
      researchGaps.push({
        field: "industry",
        why: "Nothing in the pipeline says what this brand does, and the segment drives the scorecard, the whitespace map and the playbook advice.",
        suggestedQuery: name ? `${name} company sector industry what they do` : "brand sector",
      });
    }
  }

  const peers = industry ? brands.filter((b) => b.industry === industry) : brands;
  const peerLabel = industry ? `${industry} leads` : "leads";

  // Value: the median of what comparable deals were actually worth, with the
  // quartiles, because a single number hides how wide the spread is.
  if (draft.valueEur == null) {
    const values = peers.map((b) => b.scores?.budget).filter((v): v is number => typeof v === "number" && v > 0);
    if (values.length >= 3) {
      const m = median(values);
      suggestions.push({
        field: "valueEur",
        value: m,
        label: eur(m),
        confidence: confidenceFor(values.length),
        basis: `Median of ${values.length} ${peerLabel} carrying a value; the middle half runs ${eur(quantile(values, 0.25))} to ${eur(quantile(values, 0.75))}.`,
        sampleSize: values.length,
      });
    } else {
      researchGaps.push({
        field: "valueEur",
        why: `Too few ${peerLabel} carry a value to take a median from (${values.length}).`,
        suggestedQuery: name ? `${name} marketing budget campaign spend` : "typical campaign budget",
      });
    }
  }

  // Owner: whoever actually works this segment, by count of live deals. Not
  // "who is free" - the pipeline has no idea how busy anybody is.
  if (!draft.owner) {
    const live = openLeads(peers);
    const counts = new Map<string, number>();
    for (const b of live) if (b.owner) counts.set(b.owner, (counts.get(b.owner) ?? 0) + 1);
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length) {
      const [owner, n] = ranked[0];
      suggestions.push({
        field: "owner",
        value: owner,
        label: owner,
        confidence: ranked.length === 1 || n > (ranked[1]?.[1] ?? 0) ? "medium" : "low",
        basis: `${owner} owns ${n} of the ${live.length} live ${peerLabel}${ranked.length > 1 ? `, ahead of ${ranked[1][0]} with ${ranked[1][1]}` : ""}. This is who works the segment, not who has capacity.`,
        sampleSize: live.length,
      });
    }
  }

  // Stage: not a guess. A lead being created is at the start by definition,
  // unless the person says otherwise.
  if (!draft.status) {
    suggestions.push({
      field: "status",
      value: "Seed",
      label: "Seed",
      confidence: "high",
      basis: "A lead being created has not been approached yet unless you say it has. Move it on with advance_lead_stage once contact is made.",
      sampleSize: 0,
    });
  }

  // Duration: measured, not estimated - closed deals know how long they took.
  if (draft.expectedMonths == null) {
    const durations = peers
      .filter((b) => outcomeOf(b.status) !== "open")
      .map((b) => effectiveTempoMonths(b).months)
      .filter((m): m is number => typeof m === "number" && m > 0);
    if (durations.length >= 3) {
      const m = median(durations);
      suggestions.push({
        field: "expectedMonths",
        value: Number(m.toFixed(1)),
        label: `${m.toFixed(1)} months`,
        confidence: confidenceFor(durations.length),
        basis: `Median measured duration of ${durations.length} finished ${peerLabel}. This is how long they really took, not what anyone predicted.`,
        sampleSize: durations.length,
      });
    }
  }

  // Priority is a read of the conversation, not of the money. Say so.
  if (!draft.priority) {
    suggestions.push({
      field: "priority",
      value: "Medium",
      label: "Medium",
      confidence: "low",
      basis: "High, medium and low describe how the conversation is going, which nothing in the record can know yet. Medium is the neutral placeholder - correct it from what you know.",
      sampleSize: 0,
    });
  }

  if (name) {
    researchGaps.push({
      field: "notes",
      why: "Anything current about the brand - a campaign, a rebrand, a new CMO, a funding round - is context the pipeline cannot hold and is usually the reason to call now.",
      suggestedQuery: `${name} marketing campaign news ${new Date().getFullYear()}`,
    });
  }

  return {
    for: "create_lead",
    suggestions,
    researchGaps,
    possibleDuplicates,
    note:
      "These are proposals with their evidence attached, not decisions. Put them to the user, say what each is based on, and let them correct anything before the lead is created.",
  };
}
