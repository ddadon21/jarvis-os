import type { ActionLevel, Domain } from "@/core/types";
import type { MoveCandidate } from "@/core/next-move/types";
import type { WorldStateSlice } from "@/core/world-state/types";

/**
 * The contract every operating domain implements.
 *
 * This is the seam that keeps Trading, Finance, SentryOps and Life genuinely
 * separate. Jarvis Core never reaches into a domain's tables; it asks two
 * questions through this interface — "what is happening?" and "what should I
 * consider doing?" — and synthesises the answers. A domain can be rewritten
 * wholesale without core noticing, which is the point.
 */

export interface DomainContext {
  readonly userId: string;
  /** Evaluation time. Passed in rather than read from the clock so that
   *  snapshots, backtests and tests are reproducible. */
  readonly now: Date;
  /** The highest autonomy currently granted in this domain. */
  readonly actionLevel: ActionLevel;
}

export interface DomainModule {
  readonly domain: Domain;
  /** One-line identity for the domain, shown in docs and the agent registry. */
  readonly mission: string;
  /** Structured answer to "what is happening in this domain right now?". */
  getStateSlice(context: DomainContext): Promise<WorldStateSlice>;
  /** Candidate moves this domain believes are worth considering. Core ranks them. */
  proposeMoves(context: DomainContext): Promise<MoveCandidate[]>;
}
