import { readinessRank, type ReadinessLevel } from "@/core/types";
import type {
  CriterionReadiness,
  Goal,
  GoalCriterion,
  GoalReadiness,
} from "@/core/goals/types";

/**
 * Readiness computation.
 *
 * The rollup rules, in order. They are ordered and total — for any set of
 * criteria exactly one rule fires, which is what makes the result explainable:
 *
 *   1. A goal with no criteria is RED. Unmeasured is not the same as ready.
 *   2. Any BLOCKING criterion at RED makes the goal RED, regardless of score.
 *   3. Every criterion GREEN makes the goal GREEN.
 *   4. A weighted score below 0.50 makes the goal RED.
 *   5. Anything else is YELLOW.
 *
 * Note what rule 3 rules out: a goal cannot reach GREEN on a high average while
 * one criterion is still failing. That is deliberate. Averages are how you end
 * up "87% ready" to move out with no deposit saved.
 */

/** Weighted score below this is RED even with no individual RED criterion. */
export const RED_SCORE_CEILING = 0.5;

export function evaluateCriterion(criterion: GoalCriterion): CriterionReadiness {
  const level = criterionLevel(criterion);
  const progress = criterionProgress(criterion);

  const gapToGreen = gapTo(criterion, criterion.greenThreshold);
  const gapToNextLevel =
    level === "green" ? 0 : level === "yellow" ? gapToGreen : gapTo(criterion, criterion.yellowThreshold);

  return {
    criterionId: criterion.id,
    key: criterion.key,
    label: criterion.label,
    unit: criterion.unit,
    level,
    progress,
    currentValue: criterion.currentValue,
    greenThreshold: criterion.greenThreshold,
    yellowThreshold: criterion.yellowThreshold,
    blocking: criterion.blocking,
    weight: criterion.weight,
    gapToNextLevel,
    gapToGreen,
  };
}

export function criterionLevel(criterion: GoalCriterion): ReadinessLevel {
  const { currentValue, greenThreshold, yellowThreshold, direction } = criterion;

  if (direction === "at_least") {
    if (currentValue >= greenThreshold) return "green";
    if (currentValue >= yellowThreshold) return "yellow";
    return "red";
  }

  if (currentValue <= greenThreshold) return "green";
  if (currentValue <= yellowThreshold) return "yellow";
  return "red";
}

/**
 * 0..1 progress toward GREEN.
 *
 * For `at_most` criteria the start point matters: paying a $14k balance down to
 * $9k against a $0 target is real progress, but only `baselineValue` makes that
 * visible. Without a baseline we fall back to a ratio, which is well-behaved
 * for thresholds like "utilisation under 10%" but cannot represent a zero
 * target — that case returns 0 until the target is actually met.
 */
export function criterionProgress(criterion: GoalCriterion): number {
  const { currentValue, greenThreshold, direction, baselineValue } = criterion;

  if (direction === "at_least") {
    if (greenThreshold <= 0) return currentValue >= greenThreshold ? 1 : 0;
    return clamp01(currentValue / greenThreshold);
  }

  if (currentValue <= greenThreshold) return 1;

  if (baselineValue !== undefined && baselineValue > greenThreshold) {
    return clamp01((baselineValue - currentValue) / (baselineValue - greenThreshold));
  }

  if (greenThreshold <= 0) return 0;
  if (currentValue <= 0) return 1;
  return clamp01(greenThreshold / currentValue);
}

/** Distance from the current value to a threshold, in the criterion's unit. */
function gapTo(criterion: GoalCriterion, threshold: number): number {
  const delta =
    criterion.direction === "at_least"
      ? threshold - criterion.currentValue
      : criterion.currentValue - threshold;
  return delta > 0 ? delta : 0;
}

export function computeGoalReadiness(goal: Goal): GoalReadiness {
  const criteria = goal.criteria.map(evaluateCriterion);

  if (criteria.length === 0) {
    return {
      goalId: goal.id,
      level: "red",
      score: 0,
      criteria: [],
      blockers: [],
      rationale: "No criteria defined. A goal is not measurable until it has criteria.",
    };
  }

  const score = weightedScore(criteria);
  const blockingRed = criteria.filter((c) => c.blocking && c.level === "red");
  const allGreen = criteria.every((c) => c.level === "green");

  const level = resolveLevel({ blockingRedCount: blockingRed.length, allGreen, score });

  const blockers = criteria
    .filter((c) => c.level !== "green")
    .sort((a, b) => {
      if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
      const byLevel = readinessRank[a.level] - readinessRank[b.level];
      if (byLevel !== 0) return byLevel;
      return b.weight - a.weight;
    });

  return {
    goalId: goal.id,
    level,
    score,
    criteria,
    blockers,
    rationale: buildRationale(level, score, blockers, blockingRed),
  };
}

function resolveLevel(input: {
  blockingRedCount: number;
  allGreen: boolean;
  score: number;
}): ReadinessLevel {
  if (input.blockingRedCount > 0) return "red";
  if (input.allGreen) return "green";
  if (input.score < RED_SCORE_CEILING) return "red";
  return "yellow";
}

export function weightedScore(criteria: readonly CriterionReadiness[]): number {
  const totalWeight = criteria.reduce((sum, c) => sum + Math.max(c.weight, 0), 0);
  if (totalWeight === 0) return 0;

  const weighted = criteria.reduce((sum, c) => sum + c.progress * Math.max(c.weight, 0), 0);
  return clamp01(weighted / totalWeight);
}

function buildRationale(
  level: ReadinessLevel,
  score: number,
  blockers: readonly CriterionReadiness[],
  blockingRed: readonly CriterionReadiness[],
): string {
  const pct = Math.round(score * 100);

  if (level === "green") return `All criteria met (${pct}% weighted progress).`;

  if (blockingRed.length > 0) {
    const names = blockingRed.map((c) => c.label).join(", ");
    return `Blocked by a required criterion: ${names}. Overall progress is ${pct}%.`;
  }

  if (level === "red") {
    return `Weighted progress is ${pct}%, below the 50% floor. ${blockers.length} criteria are short of target.`;
  }

  const worst = blockers[0];
  const lead = worst ? ` The largest gap is ${worst.label}.` : "";
  return `On track but not ready: ${pct}% weighted progress with ${blockers.length} criteria short of target.${lead}`;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Rolls several goals into one headline level: the worst wins. */
export function rollupReadiness(levels: readonly ReadinessLevel[]): ReadinessLevel {
  if (levels.length === 0) return "red";
  return levels.reduce<ReadinessLevel>(
    (worst, level) => (readinessRank[level] < readinessRank[worst] ? level : worst),
    "green",
  );
}
