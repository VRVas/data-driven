import "server-only";
import Ajv from "ajv";
import { can } from "@/lib/auth/authorize";
import type { SessionUser } from "@/lib/auth/guards";
import { b } from "./blocks";
import { executionPolicy, withExecutionPolicy, type ProposedAction } from "./execution";
import { getCopilotProvider, type AskOptions, type CopilotTurn } from "./provider";
import { getToolByName } from "./tools";
import { withDataset } from "@/lib/recovery/control";

const validator = new Ajv({ strict: false, validateFormats: false });

export function validToolArguments(toolName: string, args: Record<string, unknown>): boolean {
  const tool = getToolByName(toolName);
  return !!tool && validator.validate(tool.parameters, args) === true;
}

export function actionKey(action: ProposedAction): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
    }
    return value;
  };
  return JSON.stringify(canonical(action));
}

export async function runCopilotTurn(message: string, user: SessionUser, options: AskOptions = {}): Promise<CopilotTurn> {
  return withDataset((_target, signal) => runInDataset(message, user, { ...options, signal: options.signal ? AbortSignal.any([signal, options.signal]) : signal }));
}

async function runInDataset(message: string, user: SessionUser, options: AskOptions): Promise<CopilotTurn> {
  const inherited = executionPolicy();
  const proposed: ProposedAction[] = [];
  const turn = await withExecutionPolicy({
    ...inherited,
    signal: options.signal ?? inherited?.signal,
    writes: inherited?.writes === "deny" ? "deny" : "propose",
    propose: (action) => proposed.push(action),
  }, () => getCopilotProvider().ask(message, user, options));
  const existing = new Set(turn.blocks.flatMap((block) => block.type === "actions"
    ? block.actions.map((action) => actionKey({ tool: action.tool, args: action.args ?? {} })) : []));
  const additions = [];
  for (const action of proposed) {
    const key = actionKey(action);
    if (existing.has(key) || !validToolArguments(action.tool, action.args)) continue;
    existing.add(key);
    const tool = getToolByName(action.tool)!;
    if (tool.permission && !(await can(tool.permission))) continue;
    additions.push({ label: `Confirm ${action.tool.replaceAll("_", " ")}`, ...action, confirm: "Apply this change to the CRM?" });
  }
  if (proposed.length) turn.blocks = [b.callout("Changes are proposed only. Confirm an action to apply it.", "warning"), ...turn.blocks.filter((block) => block.type === "actions")];
  for (let offset = 0; offset < additions.length; offset += 4) turn.blocks.push(b.actions(additions.slice(offset, offset + 4)));
  return turn;
}