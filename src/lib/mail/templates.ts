import type { Brand } from "@/lib/types";

export interface OutreachTemplate {
  id: string;
  label: string;
  description: string;
}

export const OUTREACH_TEMPLATES: OutreachTemplate[] = [
  { id: "intro", label: "Intro", description: "First-touch introduction" },
  { id: "follow-up", label: "Follow-up", description: "Nudge after prior contact" },
  { id: "proposal", label: "Proposal", description: "Propose a concrete pilot" },
  { id: "re-engage", label: "Re-engage", description: "Revive a stalled conversation" },
];

export const DEFAULT_TEMPLATE_ID = "intro";

export interface RenderedMessage {
  subject: string;
  body: string;
}

function firstName(poc: string | null | undefined): string {
  const n = (poc ?? "").trim();
  if (!n) return "there";
  return n.split(/\s+/)[0];
}

function industryPhrase(brand: Brand): string {
  return brand.industry ? `${brand.industry.toLowerCase()} brands` : "ambitious brands";
}

/**
 * Render an outreach template for a brand. Pure + deterministic so it's easy to
 * unit-test and preview. Falls back to the intro template for unknown ids.
 */
export function renderTemplate(
  templateId: string,
  ctx: { brand: Brand; senderName: string },
): RenderedMessage {
  const { brand, senderName } = ctx;
  const hi = firstName(brand.poc);
  const sign = `${senderName}\nOOVIE Studios`;

  switch (templateId) {
    case "follow-up":
      return {
        subject: `Following up — OOVIE × ${brand.name}`,
        body:
          `Hi ${hi},\n\n` +
          `Circling back on my note about bringing OOVIE's AI-native music and video work to ${brand.name}. ` +
          `I'd love to find 20 minutes to walk you through a couple of ideas tailored to you.\n\n` +
          `Would later this week suit?\n\n` +
          `Best,\n${sign}`,
      };
    case "proposal":
      return {
        subject: `A pilot for ${brand.name}`,
        body:
          `Hi ${hi},\n\n` +
          `Following our conversation, here's what a first collaboration with OOVIE could look like for ${brand.name}: ` +
          `a compact, AI-produced music-and-video moment we can ship fast and measure.\n\n` +
          `If the direction resonates, I'll put together a short scope and timeline.\n\n` +
          `Best,\n${sign}`,
      };
    case "re-engage":
      return {
        subject: `Reviving our conversation — OOVIE × ${brand.name}`,
        body:
          `Hi ${hi},\n\n` +
          `It's been a while since we last spoke about ${brand.name}. A lot has moved on our side, and I still think ` +
          `there's a strong fit. Worth a quick catch-up to compare notes?\n\n` +
          `Best,\n${sign}`,
      };
    case "intro":
    default:
      return {
        subject: `OOVIE × ${brand.name} — a quick idea`,
        body:
          `Hi ${hi},\n\n` +
          `I'm ${senderName} from OOVIE Studios. We craft AI-native music and video experiences for ${industryPhrase(brand)}, ` +
          `and ${brand.name} stood out as a natural fit.\n\n` +
          `Would you be open to a short call to explore what a collaboration could look like?\n\n` +
          `Best,\n${sign}`,
      };
  }
}
