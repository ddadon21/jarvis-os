import type { Horizon } from "@/core/types";
import type {
  FactorContribution,
  MoveCandidate,
  MoveFactors,
  NextMoveWeights,
  ScoredMove,
} from "@/core/next-move/types";

/**
 * Default factor weights.
 *
 * These encode a point of view and are meant to be tuned against outcomes once
 * there is outcome data to tune against (see docs/ROADMAP.md — "Measure
 * outcomes"). Until then: goal alignment and expected value dominate, because
 * the failure mode this system exists to prevent is busy days that move no
 * goal; urgency matters but does not win on its own, because urgency is how
 * everything else gets crowded out.
 */
export const DEFAULT_WEIGHTS: NextMoveWeights = {
  goalAlignment: 0.22,
  expectedValue: 0.2,
  strategicImportance: 0.16,
  urgency: 0.16,
  contextFit: 0.1,
  reversibility: 0.04,
  risk: 0.08,
  opportunityCost: 0.06,
  effort: 0.06,
};

/**
 * The financial impact that counts as "maximal" for scoring purposes, in minor
 * units. $25,000. Impact is mapped logarithmically against this: the difference
 * between a $50 move and a $5,000 move should matter far more than the
 * difference between $50,000 and $55,000.
 */
export const IMPACT_SCALE_MINOR_UNITS = 2_500_000;

/** Work longer than this is treated as maximum effort for the penalty term. */
export const EFFORT_SCALE_MINUTES = 240;

/** Score multiplier applied while dependencies are outstanding. */
export const BLOCKED_PENALTY = 0.35;

export function normalizeExpectedValue(minorUnits: number | undefined): number {
  if (minorUnits === undefined || minorUnits === 0) return 0;
  const magnitude = Math.abs(minorUnits);
  const normalized = Math.log10(1 + magnitude) / Math.log10(1 + IMPACT_SCALE_MINOR_UNITS);
  const bounded = clamp01(normalized);
  // A move that *avoids* a loss is as valuable as one that earns the same
  // amount, so magnitude drives the score and sign is preserved only for
  // display. Negative expected value means "this costs money", which is still
  // worth doing when it prevents a larger loss — the caller expresses that by
  // passing the avoided amount as a positive value.
  return minorUnits > 0 ? bounded : bounded * 0.6;
}

export function normalizeEffort(minutes: number): number {
  if (minutes <= 0) return 0;
  return clamp01(minutes / EFFORT_SCALE_MINUTES);
}

/**
 * Scores one candidate.
 *
 * Shape of the formula:
 *   (weighted benefits) × probabilityOfSuccess − (weighted penalties)
 *
 * Probability is multiplicative rather than another weighted term because it is
 * categorically different: a 10%-likely outcome is worth a tenth of the same
 * outcome, not "slightly fewer points".
 */
export function scoreCandidate(
  candidate: MoveCandidate,
  weights: NextMoveWeights = DEFAULT_WEIGHTS,
  now: Date = new Date(),
): ScoredMove {
  const f = candidate.factors;
  const impact = normalizeExpectedValue(f.expectedValue);
  const effort = normalizeEffort(f.estimatedMinutes);

  const benefits: FactorContribution[] = [
    { factor: "goalAlignment", contribution: weights.goalAlignment * clamp01(f.goalAlignment) },
    { factor: "expectedValue", contribution: weights.expectedValue * impact },
    {
      factor: "strategicImportance",
      contribution: weights.strategicImportance * clamp01(f.strategicImportance),
    },
    { factor: "urgency", contribution: weights.urgency * clamp01(f.urgency) },
    { factor: "contextFit", contribution: weights.contextFit * clamp01(f.contextFit) },
    { factor: "reversibility", contribution: weights.reversibility * clamp01(f.reversibility) },
  ];

  const probability = clamp01(f.probabilityOfSuccess);
  const benefitTotal = benefits.reduce((sum, c) => sum + c.contribution, 0) * probability;

  const penalties: FactorContribution[] = [
    { factor: "risk", contribution: -(weights.risk * clamp01(f.risk)) },
    { factor: "opportunityCost", contribution: -(weights.opportunityCost * clamp01(f.opportunityCost)) },
    { factor: "effort", contribution: -(weights.effort * effort) },
  ];

  const penaltyTotal = penalties.reduce((sum, c) => sum + c.contribution, 0);

  const raw = benefitTotal + penaltyTotal;
  const score = clamp01(candidate.blocked ? raw * BLOCKED_PENALTY : raw);

  const contributions = [...benefits, ...penalties]
    .map((c) => ({ factor: c.factor, contribution: round4(c.contribution * (c.contribution > 0 ? probability : 1)) }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  const horizon = resolveHorizon(candidate, score, now);

  return {
    candidate,
    score: round4(score),
    horizon,
    contributions,
    rationale: buildRationale(candidate, score, horizon, contributions, probability),
  };
}

/**
 * Horizon placement.
 *
 * Score decides the default slot; a deadline can only pull a move *earlier*,
 * never push it later. A blocked move can never be NOW — "do it now" is a lie
 * when a prerequisite is outstanding.
 */
export function resolveHorizon(candidate: MoveCandidate, score: number, now: Date = new Date()): Horizon {
  const fromScore = horizonFromScore(score);
  const fromDeadline = horizonFromDeadline(candidate.dueAt, now);

  const horizon = sooner(fromScore, fromDeadline);
  if (candidate.blocked && horizon === "now") return "next";
  return horizon;
}

const horizonOrder: readonly Horizon[] = ["now", "next", "today", "this_week", "longer_term"];

function horizonFromScore(score: number): Horizon {
  if (score >= 0.72) return "now";
  if (score >= 0.58) return "next";
  if (score >= 0.44) return "today";
  if (score >= 0.28) return "this_week";
  return "longer_term";
}

function horizonFromDeadline(dueAt: string | undefined, now: Date): Horizon {
  if (!dueAt) return "longer_term";

  const hoursOut = (Date.parse(dueAt) - now.getTime()) / 3_600_000;
  if (Number.isNaN(hoursOut)) return "longer_term";
  if (hoursOut <= 2) return "now";
  if (hoursOut <= 8) return "next";
  if (hoursOut <= 24) return "today";
  if (hoursOut <= 24 * 7) return "this_week";
  return "longer_term";
}

function sooner(a: Horizon, b: Horizon): Horizon {
  return horizonOrder.indexOf(a) <= horizonOrder.indexOf(b) ? a : b;
}

function buildRationale(
  candidate: MoveCandidate,
  score: number,
  horizon: Horizon,
  contributions: readonly FactorContribution[],
  probability: number,
): string {
  if (candidate.blocked) {
    const count = candidate.dependsOn?.length ?? 0;
    return `Held at ${horizon.replace("_", " ")}: ${count} unresolved ${count === 1 ? "dependency" : "dependencies"}.`;
  }

  const top = contributions.filter((c) => c.contribution > 0).slice(0, 2);
  const drag = contributions.find((c) => c.contribution < -0.02);

  const driver = top.length > 0 ? top.map((c) => humanFactor(c.factor)).join(" and ") : "no strong driver";
  const dragText = drag ? ` Held back by ${humanFactor(drag.factor)}.` : "";
  const oddsText = probability < 0.5 ? ` Odds of success are estimated at ${Math.round(probability * 100)}%.` : "";

  return `Scored ${Math.round(score * 100)} on ${driver}.${dragText}${oddsText}`;
}

function humanFactor(factor: string): string {
  const labels: Record<string, string> = {
    goalAlignment: "goal alignment",
    expectedValue: "financial impact",
    strategicImportance: "strategic importance",
    urgency: "urgency",
    contextFit: "context fit",
    reversibility: "reversibility",
    risk: "risk",
    opportunityCost: "opportunity cost",
    effort: "time required",
  };
  return labels[factor] ?? factor;
}

/** Scores and ranks a set of candidates. Highest score first. */
export function rankMoves(
  candidates: readonly MoveCandidate[],
  weights: NextMoveWeights = DEFAULT_WEIGHTS,
  now: Date = new Date(),
): ScoredMove[] {
  return candidates
    .map((candidate) => scoreCandidate(candidate, weights, now))
    .sort((a, b) => b.score - a.score);
}

/** Groups ranked moves by horizon, preserving rank order within each bucket. */
export function groupByHorizon(moves: readonly ScoredMove[]): Record<Horizon, ScoredMove[]> {
  const grouped: Record<Horizon, ScoredMove[]> = {
    now: [],
    next: [],
    today: [],
    this_week: [],
    longer_term: [],
  };
  for (const move of moves) grouped[move.horizon].push(move);
  return grouped;
}

/** Convenience for building factor sets in tests, seeds and adapters. */
export function factors(overrides: Partial<MoveFactors> = {}): MoveFactors {
  return {
    urgency: 0,
    strategicImportance: 0,
    goalAlignment: 0,
    contextFit: 0.5,
    probabilityOfSuccess: 0.8,
    risk: 0,
    opportunityCost: 0,
    reversibility: 1,
    estimatedMinutes: 30,
    ...overrides,
  };
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
