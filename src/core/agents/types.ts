import type { ActionLevel, Domain } from "@/core/types";
import type { Capability } from "@/core/permissions/capabilities";
import type { MemoryScope } from "@/core/memory/types";

/**
 * Specialist agent contract.
 *
 * Every agent is declared with an explicit surface before it is built:
 * what it owns, what it may touch, what it may never do, what memory it can
 * see, and what shape its output takes. An agent without a declared output
 * contract is how you end up parsing prose to decide whether to move money.
 */
export interface AgentSpec {
  readonly id: string;
  readonly name: string;
  readonly domain: Domain;
  readonly mission: string;
  readonly responsibilities: readonly string[];
  /** Capabilities this agent may request. Nothing outside this list is reachable. */
  readonly allowedCapabilities: readonly Capability[];
  /** Explicit prohibitions. Stated even when implied, because it documents intent. */
  readonly prohibited: readonly string[];
  readonly memoryScope: MemoryScope;
  /** Autonomy ceiling for this agent, applied on top of capability ceilings. */
  readonly maxActionLevel: ActionLevel;
  /** What this agent returns. Validated before anything downstream consumes it. */
  readonly outputContract: string;
}

export const agentRunStatuses = ["idle", "running", "succeeded", "failed", "disabled"] as const;
export type AgentRunStatus = (typeof agentRunStatuses)[number];

/** Durable per-agent runtime state. Backs the `agent_states` table. */
export interface AgentState {
  readonly id: string;
  readonly userId: string;
  readonly agentId: string;
  readonly status: AgentRunStatus;
  readonly lastRunAt?: string;
  readonly lastResultSummary?: string;
  readonly lastError?: string;
  /**
   * Where the agent left off — a timestamp, event id or pagination token.
   * Lets a long-running observer resume instead of reprocessing history.
   */
  readonly cursor?: string;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly updatedAt: string;
}
