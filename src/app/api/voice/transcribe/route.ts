import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { can } from "@/lib/auth/authorize";
import { transcribe, isSpeechConfigured } from "@/lib/speech/provider";

export const dynamic = "force-dynamic";

const EXT: Record<string, string> = {
  "audio/webm": "audio.webm",
  "audio/ogg": "audio.ogg",
  "audio/wav": "audio.wav",
  "audio/x-wav": "audio.wav",
  "audio/mp4": "audio.mp4",
  "audio/mpeg": "audio.mp3",
  "audio/flac": "audio.flac",
};

/** Speech-to-text: the client POSTs the recorded audio blob as the body. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await can("copilot:use"))) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!isSpeechConfigured()) return Response.json({ error: "Voice not configured" }, { status: 503 });

  const contentType = (req.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
  const audio = await req.arrayBuffer();
  if (!audio || audio.byteLength === 0) return Response.json({ error: "No audio" }, { status: 400 });
  if (audio.byteLength > 25 * 1024 * 1024) return Response.json({ error: "Audio too large" }, { status: 413 });

  try {
    const text = await transcribe(audio, {
      contentType,
      filename: EXT[contentType] ?? "audio.webm",
    });
    return Response.json({ text });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
