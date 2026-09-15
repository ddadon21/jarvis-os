import type { ActionLevel, Domain, Horizon, MinorUnits } from "@/core/types";

/**
 * The Next Move Engine.
 *
 * The question this answers is "what is the highest-leverage thing to do right
 * now?", which is not the same question as "what is the highest-priority
 * task?". A priority field collapses a dozen considerations into one number
 * chosen by hand. Here the considerations stay separate, are scored
 * explicitly, and the reason a move won can always be reconstructed.
 */

/**
 * Scoring inputs. Every 0..1 field is a fraction; anything else is named with
 * its unit. Inputs are supplied by the domain that owns the candidate — a
 * domain knows what a trade review is worth far better than core does.
 */
export interface MoveFactors {
  /** Deadline pressure, independent of importance. 0 = no time pressure. */
  readonly urgency: number;
  /** Expected financial effect, signed. Used on a log scale — see scoring.ts. */
  readonly expectedValue?: MinorUnits;
  /** Long-term positioning value that money does not capture. */
  readonly strategicImportance: number;
  /** How directly this advances an active goal. */
  readonly goalAlignment: number;
  /** Fit with the user's current mode and context (market hours, workday, …). */
  readonly contextFit: number;
  /** 0..1 chance this actually produces the intended outcome. */
  readonly probabilityOfSuccess: number;
  /** Downside exposure if it goes wrong. A penalty. */
  readonly risk: number;
  /** What is given up by spending this slot here. A penalty. */
  readonly opportunityCost: number;
  /** How easily the action can be undone. 1 = trivially reversible. */
  readonly reversibility: number;
  readonly estimatedMinutes: number;
}

export interface MoveCandidate {
  readonly id: string;
  readonly userId: string;
  readonly domain: Domain;
  readonly title: string;
  readonly summary?: string;
  readonly factors: MoveFactors;
  /** Ids of candidates or records that must be resolved first. */
  readonly dependsOn?: readonly string[];
  /** True when at least one dependency is still outstanding. */
  readonly blocked?: boolean;
  /** Autonomy this move would require if Jarvis performed it. */
  readonly requiredActionLevel: ActionLevel;
  /** Hard deadline, if any. Caps the horizon regardless of score. */
  readonly dueAt?: string;
  readonly sourceKind: "task" | "event" | "goal" | "agent" | "manual";
  readonly sourceId?: string;
}

export interface FactorContribution {
  readonly factor: string;
  /** Signed contribution to the final score. */
  readonly contribution: number;
}

export interface ScoredMove {
  readonly candidate: MoveCandidate;
  /** 0..1. Comparable across domains — that is the whole point. */
  readonly score: number;
  readonly horizon: Horizon;
  /** Largest contributors, positive and negative, for explainability. */
  readonly contributions: readonly FactorContribution[];
  readonly rationale: string;
}

export interface NextMoveWeights {
  readonly urgency: number;
  readonly expectedValue: number;
  readonly strategicImportance: number;
  readonly goalAlignment: number;
  readonly contextFit: number;
  readonly reversibility: number;
  readonly risk: number;
  readonly opportunityCost: number;
  readonly effort: number;
}
