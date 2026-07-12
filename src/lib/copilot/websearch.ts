import "server-only";

// ---------------------------------------------------------------------------
// Web grounding via Foundry IQ agentic retrieval (Grounding with Bing).
// Verified live 2026-07-12 on our account, keyless (Entra/managed identity):
//   POST {searchEndpoint}/knowledgebases/{kb}/retrieve?api-version=2026-05-01-preview
//   Authorization: Bearer <token, audience https://search.azure.com>
//   body { messages:[{role:'user',content:[{type:'text',text}]}],
//          knowledgeSourceParams:[{knowledgeSourceName:'web-grounding',kind:'web'}] }
// Azure AI Search runs Grounding-with-Bing + LLM answer synthesis (gpt-5.4-mini)
// internally and returns a cited answer over live public web results:
//   { response:[{content:[{text}]}], references:[{id,type,title,url}], activity:[…] }
// The app's managed identity needs "Search Index Data Reader" on the search service.
// Docs: https://learn.microsoft.com/azure/search/agentic-retrieval-how-to-retrieve
// ---------------------------------------------------------------------------

const API_VERSION = "2026-05-01-preview";
const SEARCH_SCOPE = "https://search.azure.com/.default";
const MAX_SOURCES = 8;

function searchEndpoint(): string | null {
  const e = process.env.AZURE_SEARCH_ENDPOINT;
  return e ? e.replace(/\/+$/, "") : null;
}

/** Web grounding is available only when the search service endpoint is wired. */
export function isWebGroundingConfigured(): boolean {
  return !!searchEndpoint();
}

async function searchToken(): Promise<string> {
  const { DefaultAzureCredential } = await import("@azure/identity");
  const token = await new DefaultAzureCredential().getToken(SEARCH_SCOPE);
  if (!token?.token) throw new Error("web grounding: could not acquire a search token");
  return token.token;
}

export interface WebSource {
  /** 1-based citation number, aligned to the [n] markers in `answer`. */
  n: number;
  title: string;
  url: string;
}

export interface WebAnswer {
  answer: string;
  sources: WebSource[];
}

export interface RetrieveResponse {
  response?: { content?: { text?: string }[] }[];
  references?: { id?: string; type?: string; title?: string; url?: string }[];
}

/**
 * Pure parser (unit-tested): flatten the synthesized answer, keep the cited web
 * pages, and renumber `[ref_id:N]` markers to 1-based `[n]` matching the source list.
 */
export function normalizeWebAnswer(data: RetrieveResponse): WebAnswer {
  const rawAnswer = (data.response ?? [])
    .flatMap((m) => m?.content ?? [])
    .map((c) => c?.text ?? "")
    .join("")
    .trim();

  // Keep web references that carry a url; cap for the UI; renumber 1-based.
  const refs = (data.references ?? []).filter((r) => r?.url).slice(0, MAX_SOURCES);
  const idToN = new Map<string, number>();
  const sources: WebSource[] = refs.map((r, i) => {
    const n = i + 1;
    if (r.id != null) idToN.set(String(r.id), n);
    return { n, title: (r.title || r.url) as string, url: r.url as string };
  });

  // Rewrite [ref_id:N] → [n] for shown sources; drop markers to dropped refs.
  const answer = rawAnswer.replace(/\[ref_id:(\d+)\]/g, (_m, id: string) => {
    const n = idToN.get(id);
    return n ? `[${n}]` : "";
  });

  return { answer, sources };
}

/** Ask the web knowledge base and return a synthesized answer + cited web sources. */
export async function groundedWebAnswer(query: string): Promise<WebAnswer> {
  const base = searchEndpoint();
  if (!base) throw new Error("web grounding is not configured");
  const kb = process.env.AZURE_SEARCH_KNOWLEDGE_BASE ?? "web-kb";
  const ks = process.env.AZURE_SEARCH_WEB_KS ?? "web-grounding";

  const res = await fetch(`${base}/knowledgebases/${kb}/retrieve?api-version=${API_VERSION}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await searchToken()}` },
    body: JSON.stringify({
      messages: [{ role: "user", content: [{ type: "text", text: query }] }],
      knowledgeSourceParams: [{ knowledgeSourceName: ks, kind: "web" }],
    }),
  });
  if (!res.ok) {
    throw new Error(`web retrieve failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return normalizeWebAnswer((await res.json()) as RetrieveResponse);
}
