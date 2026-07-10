import "server-only";
import { getToolByName } from "./tools";
import type { SessionUser } from "@/lib/auth/guards";

export interface ToolRun {
  ok: boolean;
  tool: string;
  args?: Record<string, unknown>;
  data?: unknown;
  error?: string;
}

/**
 * Execute a single copilot tool on behalf of a user. Errors are captured
 * (never thrown) so the chat loop can surface them to the model / UI.
 * Write tools enforce their own role rules inside `execute` (e.g. members'
 * outreach becomes pending-approval; sending is never done here).
 */
export async function runTool(
  name: string,
  args: Record<string, unknown>,
  user: SessionUser,
): Promise<ToolRun> {
  const tool = getToolByName(name);
  if (!tool) return { ok: false, tool: name, error: `Unknown tool: ${name}` };
  try {
    const data = await tool.execute(args ?? {}, { user });
    return { ok: true, tool: name, args, data };
  } catch (e) {
    return { ok: false, tool: name, args, error: e instanceof Error ? e.message : "Tool execution failed" };
  }
}
