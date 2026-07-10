import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, type SessionUser } from "@/lib/auth/guards";
import { getToolByName } from "@/lib/copilot/tools";
import { runTool } from "@/lib/copilot/dispatch";

export const dynamic = "force-dynamic";

// Read-only service identity used when the caller authenticates with an API key
// (e.g. the Foundry OpenAPI tool). Write tools are rejected on this channel.
const SERVICE_USER: SessionUser = { id: "copilot-service", name: "Copilot Service", email: "", role: "member" };

export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const tool = getToolByName(name);
  if (!tool) return NextResponse.json({ error: `Unknown tool: ${name}` }, { status: 404 });

  const session = await getSessionUser();
  const apiKey = process.env.COPILOT_API_KEY;
  const keyAuthed = !!apiKey && (req.headers.get("x-api-key") ?? "") === apiKey;

  if (!session && !keyAuthed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session && tool.write) {
    return NextResponse.json({ error: "Write tools require an in-app user session." }, { status: 403 });
  }

  let args: Record<string, unknown> = {};
  try {
    const body = await req.json();
    if (body && typeof body === "object") args = body as Record<string, unknown>;
  } catch {
    /* empty body is fine */
  }

  const run = await runTool(name, args, session ?? SERVICE_USER);
  return NextResponse.json(run, { status: run.ok ? 200 : 400 });
}
