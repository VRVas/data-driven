import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

export interface ProposedAction {
  tool: string;
  args: Record<string, unknown>;
}

export interface ExecutionPolicy {
  writes: "deny" | "propose" | "execute";
  signal?: AbortSignal;
  allowedTools?: readonly string[];
  propose?: (action: ProposedAction) => void;
}

const policies = new AsyncLocalStorage<ExecutionPolicy>();

export function executionPolicy(): ExecutionPolicy | undefined {
  return policies.getStore();
}

export function withExecutionPolicy<Result>(policy: ExecutionPolicy, work: () => Promise<Result>): Promise<Result> {
  return policies.run(policy, work);
}