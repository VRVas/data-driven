import "server-only";

/**
 * Long-term memory seam.
 *
 * Short-term context = threads (threads.ts, Cosmos-backed conversations).
 * Long-term = the Foundry Agent Service **Memory Store** (preview): durable
 * user-profile, distilled chat-summary and procedural memories, scoped per user
 * with a TTL. Best practice (per docs): inject STATIC user-profile memories at
 * conversation start, add CONTEXTUAL memories per turn, and hand each exchange
 * back to the store to distil a chat-summary.
 *
 * Docs:
 *  - https://learn.microsoft.com/azure/foundry/agents/concepts/what-is-memory
 *  - https://learn.microsoft.com/azure/foundry/agents/how-to/memory-usage
 *
 * Local dev uses a no-op; the Foundry implementation activates when
 * FOUNDRY_MEMORY_STORE_ID is set (wired on deploy - the preview API is not
 * exercised offline).
 */
export interface MemoryContext {
  /** Durable facts about the user to inject into the system prompt. */
  profile: string[];
}

export interface CopilotMemory {
  readonly name: string;
  recall(userId: string): Promise<MemoryContext>;
  remember(userId: string, userText: string, assistantSummary: string): Promise<void>;
}

class NoopMemory implements CopilotMemory {
  readonly name = "none";
  async recall(): Promise<MemoryContext> {
    return { profile: [] };
  }
  async remember(): Promise<void> {
    /* nothing to persist without a store */
  }
}

class FoundryMemory implements CopilotMemory {
  readonly name = "foundry";

  async recall(_userId: string): Promise<MemoryContext> {
    // TODO(deploy): retrieve user-profile memories (scope=user) from the Memory
    // Store and map them to profile[]. Preview API - wired at deploy time.
    return { profile: [] };
  }

  async remember(_userId: string, _userText: string, _assistantSummary: string): Promise<void> {
    // TODO(deploy): submit the exchange for chat-summary distillation.
  }
}

export function isMemoryConfigured(): boolean {
  return !!process.env.FOUNDRY_MEMORY_STORE_ID;
}

let memory: CopilotMemory | undefined;

export function getCopilotMemory(): CopilotMemory {
  if (memory) return memory;
  memory = isMemoryConfigured() ? new FoundryMemory() : new NoopMemory();
  return memory;
}
