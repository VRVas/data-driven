import "server-only";

// ---------------------------------------------------------------------------
// Document grounding via Foundry file search (basic setup, Microsoft-managed).
// Verified live (2026-07-12) on our account, keyless (Entra/MI):
//   base = {aiName}.services.ai.azure.com/openai/v1  (derived from COPILOT_CHAT_ENDPOINT)
//   POST /vector_stores, POST /files (multipart, purpose=assistants),
//   POST /vector_stores/{id}/files, poll GET /vector_stores/{id}/files/{fileId},
//   POST /responses?api-version=preview with a file_search tool -> grounded answer.
// (The retrieval-only /vector_stores/{id}/search endpoint 404s on our account.)
// ---------------------------------------------------------------------------

const RESPONSES_MODEL = process.env.COPILOT_MODEL ?? "gpt-5.4-mini";

function openaiV1Base(): string {
  if (process.env.AZURE_AI_OPENAI_V1) return process.env.AZURE_AI_OPENAI_V1.replace(/\/+$/, "");
  const chat = process.env.COPILOT_CHAT_ENDPOINT;
  if (chat) return chat.split("/chat/completions")[0];
  throw new Error("Documents: AZURE_AI_OPENAI_V1 / COPILOT_CHAT_ENDPOINT not configured.");
}

export function isDocsConfigured(): boolean {
  return !!(process.env.AZURE_AI_OPENAI_V1 || process.env.COPILOT_CHAT_ENDPOINT);
}

async function authHeaders(json = true): Promise<Record<string, string>> {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  if (process.env.COPILOT_API_KEY) {
    h["api-key"] = process.env.COPILOT_API_KEY;
    return h;
  }
  const { DefaultAzureCredential } = await import("@azure/identity");
  const token = await new DefaultAzureCredential().getToken("https://cognitiveservices.azure.com/.default");
  h.Authorization = `Bearer ${token?.token ?? ""}`;
  return h;
}

export interface DocFile {
  id: string;
  name: string;
  bytes: number;
}

/** Create an (empty) vector store; returns its id. */
export async function createVectorStore(name: string): Promise<string> {
  const res = await fetch(`${openaiV1Base()}/vector_stores`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`create vector store failed: ${res.status} ${await res.text().catch(() => "")}`);
  return (await res.json()).id as string;
}

/** Upload a file, add it to the vector store, and wait for ingestion. */
export async function uploadDocument(
  vsId: string,
  buffer: ArrayBuffer,
  filename: string,
  mime: string,
): Promise<DocFile> {
  const base = openaiV1Base();

  const form = new FormData();
  form.append("purpose", "assistants");
  form.append("file", new Blob([buffer], { type: mime || "application/octet-stream" }), filename);
  const up = await fetch(`${base}/files`, { method: "POST", headers: await authHeaders(false), body: form });
  if (!up.ok) throw new Error(`file upload failed: ${up.status} ${await up.text().catch(() => "")}`);
  const file = await up.json();
  const fileId = file.id as string;

  const add = await fetch(`${base}/vector_stores/${vsId}/files`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ file_id: fileId }),
  });
  if (!add.ok) throw new Error(`add to store failed: ${add.status}`);

  for (let i = 0; i < 30; i++) {
    const st = await fetch(`${base}/vector_stores/${vsId}/files/${fileId}`, { headers: await authHeaders(false) });
    if (st.ok) {
      const status = (await st.json()).status as string;
      if (status === "completed") break;
      if (status === "failed" || status === "cancelled") throw new Error(`ingestion ${status}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { id: fileId, name: filename, bytes: (file.bytes as number) ?? buffer.byteLength };
}

/** Remove a file from the vector store and delete the underlying file. */
export async function removeDocument(vsId: string, fileId: string): Promise<void> {
  const base = openaiV1Base();
  const headers = await authHeaders(false);
  await fetch(`${base}/vector_stores/${vsId}/files/${fileId}`, { method: "DELETE", headers }).catch(() => {});
  await fetch(`${base}/files/${fileId}`, { method: "DELETE", headers }).catch(() => {});
}

export interface DocAnswer {
  answer: string;
  citations: string[];
}

/** Answer a question grounded in the vector store's documents (file search). */
export async function answerFromDocuments(vsId: string, query: string): Promise<DocAnswer> {
  const res = await fetch(`${openaiV1Base()}/responses?api-version=preview`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      model: RESPONSES_MODEL,
      input: query,
      tools: [{ type: "file_search", vector_store_ids: [vsId] }],
    }),
  });
  if (!res.ok) throw new Error(`file_search response failed: ${res.status} ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as { output?: DocResponseItem[] };
  let answer = "";
  const citations = new Set<string>();
  for (const item of data.output ?? []) {
    if (item.type === "message") {
      for (const c of item.content ?? []) {
        if (c.text) answer += c.text;
        for (const ann of c.annotations ?? []) if (ann.filename) citations.add(ann.filename);
      }
    } else if (item.type === "file_search_call") {
      for (const r of item.results ?? []) if (r.filename) citations.add(r.filename);
    }
  }
  return { answer: answer.trim(), citations: [...citations] };
}

interface DocResponseItem {
  type: string;
  content?: { text?: string; annotations?: { filename?: string }[] }[];
  results?: { filename?: string }[];
}
