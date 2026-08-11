import { NextRequest, NextResponse } from "next/server";
import { apiPermission } from "@/lib/auth/api";
import { copilotCaller } from "@/lib/auth/service";
import { runAsPrincipal } from "@/lib/auth/principal";
import { getToolByName } from "@/lib/copilot/tools";
import { runTool } from "@/lib/copilot/dispatch";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const tool = getToolByName(name);
  if (!tool) return NextResponse.json({ error: `Unknown tool: ${name}` }, { status: 404 });

  const principal = await copilotCaller(req.headers.get("x-api-key"));
  if (!principal) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return runAsPrincipal(principal, async () => {
    const gate = await apiPermission("copilot:use");
    if (gate instanceof Response) return gate;

    // Checked here as well as inside each tool: this is the boundary where the
    // caller picks the tool by name, so it is the boundary that has to refuse.
    if (tool.write) {
      const write = await apiPermission("copilot:tool:write");
      if (write instanceof Response) return write;
    }

    let args: Record<string, unknown> = {};
    try {
      const body = await req.json();
      if (body && typeof body === "object") args = body as Record<string, unknown>;
    } catch {
      /* empty body is fine */
    }

    const run = await runTool(name, args, principal.user);
    return NextResponse.json(run, { status: run.ok ? 200 : 400 });
  });
}
