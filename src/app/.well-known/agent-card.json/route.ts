import { AgentCard } from "@a2a-js/sdk";
import { agentCard } from "@/lib/copilot/external/a2a";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.COPILOT_EXTERNAL_ENABLED !== "true") return new Response("Not found", { status: 404 });
  return Response.json(AgentCard.toJSON(agentCard()), { headers: { "cache-control": "public, max-age=300", "A2A-Version": "1.0" } });
}