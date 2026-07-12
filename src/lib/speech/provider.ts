import "server-only";

// ---------------------------------------------------------------------------
// Speech provider — keyless (Entra/managed-identity) STT + TTS on our Foundry
// AIServices account. Verified live in Sweden Central (2026-07-12):
//   TTS: POST {base}/tts/cognitiveservices/v1  (SSML, MAI-Voice-2 "Luca")
//   STT: POST {base}/speechtotext/transcriptions:transcribe?api-version=2024-11-15
// Auth = Bearer token, scope https://cognitiveservices.azure.com/.default
// (same managed identity the copilot uses; works with disableLocalAuth).
// ---------------------------------------------------------------------------

const DEFAULT_VOICE = "it-IT-Luca:MAI-Voice-2"; // Luca — multilingual, reads any language
const STT_API_VERSION = "2024-11-15";

/** Base URL of the Speech-capable account (defaults to the OpenAI endpoint host). */
function speechBase(): string {
  const ep = process.env.SPEECH_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT;
  if (!ep) throw new Error("SPEECH_ENDPOINT or AZURE_OPENAI_ENDPOINT must be set for voice.");
  return ep.replace(/\/+$/, "");
}

export function isSpeechConfigured(): boolean {
  return !!(process.env.SPEECH_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT);
}

async function authHeaders(): Promise<Record<string, string>> {
  if (process.env.SPEECH_API_KEY) return { "Ocp-Apim-Subscription-Key": process.env.SPEECH_API_KEY };
  const { DefaultAzureCredential } = await import("@azure/identity");
  const token = await new DefaultAzureCredential().getToken("https://cognitiveservices.azure.com/.default");
  return { Authorization: `Bearer ${token?.token ?? ""}` };
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** BCP-47 language to tag the SSML with. Luca is multilingual, so this just
 *  tells the model which language the text is in (defaults to English). */
function ttsLang(): string {
  return process.env.SPEECH_LANG || "en-US";
}

export function buildSsml(text: string, voice: string, lang: string): string {
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
    `xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="${lang}">` +
    `<voice name="${voice}">${escapeXml(text)}</voice></speak>`
  );
}

/** Synthesize speech (MP3) from text using the configured voice (Luca). */
export async function synthesize(
  text: string,
  opts: { voice?: string; lang?: string } = {},
): Promise<{ audio: ArrayBuffer; contentType: string }> {
  const voice = opts.voice || process.env.SPEECH_VOICE || DEFAULT_VOICE;
  const ssml = buildSsml(text.slice(0, 8000), voice, opts.lang || ttsLang());
  const res = await fetch(`${speechBase()}/tts/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      ...(await authHeaders()),
    },
    body: ssml,
  });
  if (!res.ok) throw new Error(`TTS failed: ${res.status} ${await res.text().catch(() => "")}`);
  return { audio: await res.arrayBuffer(), contentType: "audio/mpeg" };
}

/** Transcribe audio to text via fast transcription (multi-locale auto-detect). */
export async function transcribe(
  audio: ArrayBuffer,
  opts: { filename?: string; contentType?: string; locales?: string[] } = {},
): Promise<string> {
  const form = new FormData();
  form.append(
    "audio",
    new Blob([audio], { type: opts.contentType || "application/octet-stream" }),
    opts.filename || "audio.wav",
  );
  form.append(
    "definition",
    JSON.stringify({ locales: opts.locales ?? ["en-US", "it-IT"] }),
  );
  const res = await fetch(
    `${speechBase()}/speechtotext/transcriptions:transcribe?api-version=${STT_API_VERSION}`,
    { method: "POST", headers: { ...(await authHeaders()) }, body: form },
  );
  if (!res.ok) throw new Error(`STT failed: ${res.status} ${await res.text().catch(() => "")}`);
  const json = (await res.json()) as { combinedPhrases?: { text?: string }[] };
  return (json.combinedPhrases ?? [])
    .map((p) => p.text ?? "")
    .join(" ")
    .trim();
}
