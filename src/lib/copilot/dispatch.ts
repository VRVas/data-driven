import "server-only";
import { getToolByName } from "./tools";
import { can } from "@/lib/auth/authorize";
import { isAuthzError } from "@/lib/auth/errors";
import type { SessionUser } from "@/lib/auth/guards";
import { executionPolicy } from "./execution";

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
 *
 * The tool's declared permission is checked here rather than inside each
 * `execute`, so a new tool cannot become a way to do through conversation
 * what the screens refuse. Record-level scope is applied inside the tools that
 * take an id, because only they know which record is meant.
 */
export async function runTool(
  name: string,
  args: Record<string, unknown>,
  user: SessionUser,
): Promise<ToolRun> {
  const tool = getToolByName(name);
  if (!tool) return { ok: false, tool: name, error: `Unknown tool: ${name}` };
  try {
    const policy = executionPolicy();
    policy?.signal?.throwIfAborted();
    if (policy?.allowedTools && !policy.allowedTools.includes(name)) {
      return { ok: false, tool: name, error: "This integration cannot use that tool." };
    }
    if (tool.permission && !(await can(tool.permission))) {
      return { ok: false, tool: name, args, error: "You don't have permission to do that." };
    }
    if (tool.write) {
      if (!(await can("copilot:tool:write")) || policy?.writes === "deny") {
        return { ok: false, tool: name, error: "Writes are not allowed for this caller." };
      }
      if (policy?.writes === "propose") {
        policy.propose?.({ tool: name, args });
        return { ok: true, tool: name, data: { pending: true, requiresConfirmation: true, message: "Proposed only. Nothing has been changed." } };
      }
    }
    // Resolved from the session, so the key-authenticated service identity gets false.
    const canApprove = await can("outreach:approve").catch(() => false);
    const data = await tool.execute(args ?? {}, { user, canApprove });
    return { ok: true, tool: name, args, data };
  } catch (e) {
    if (isAuthzError(e)) return { ok: false, tool: name, args, error: e.message };
    return { ok: false, tool: name, args, error: e instanceof Error ? e.message : "Tool execution failed" };
  }
}
