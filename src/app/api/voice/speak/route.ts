import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { synthesize, isSpeechConfigured } from "@/lib/speech/provider";

export const dynamic = "force-dynamic";

/** Text-to-speech: returns MP3 audio of `text` read by the configured voice (Luca). */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!isSpeechConfigured()) return new Response("Voice not configured", { status: 503 });

  let text = "";
  let lang: string | undefined;
  try {
    const body = await req.json();
    text = String(body.text ?? "").trim().slice(0, 8000);
    lang = typeof body.lang === "string" ? body.lang : undefined;
  } catch {
    /* fall through */
  }
  if (!text) return new Response("Missing text", { status: 400 });

  try {
    const { audio, contentType } = await synthesize(text, { lang });
    return new Response(audio, {
      headers: { "Content-Type": contentType, "Cache-Control": "no-store" },
    });
  } catch (e) {
    return new Response(`TTS error: ${(e as Error).message}`, { status: 502 });
  }
}
