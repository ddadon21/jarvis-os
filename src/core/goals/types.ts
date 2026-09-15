import { z } from "zod";
import { domains, readinessLevels, type Domain, type ReadinessLevel } from "@/core/types";

/**
 * Goals in Jarvis are multi-criteria, not percentages.
 *
 * "Move out — 47%" is a number that cannot be acted on. "Move out — RED,
 * because the emergency reserve is $2.8k against a $9k floor and income has
 * three months of history against a six-month requirement" is. Every major
 * objective therefore decomposes into criteria that are measured
 * independently and rolled up with an explicit, documented rule.
 */

export const goalStatuses = ["active", "achieved", "paused", "abandoned"] as const;
export type GoalStatus = (typeof goalStatuses)[number];

/** How a criterion's raw value should be read and displayed. */
export const criterionUnits = [
  /** Minor units (cents). */
  "currency",
  /** 0..1 fraction. */
  "percent",
  "count",
  "months",
  /** 0..1 fraction, but a bare ratio rather than a percentage (e.g. DTI). */
  "ratio",
  /** 0 or 1. */
  "boolean",
] as const;
export type CriterionUnit = (typeof criterionUnits)[number];

/**
 * Which way "good" points.
 * `at_least` — cash reserve, months of income, credit score.
 * `at_most`  — debt balance, credit utilisation, monthly burn.
 */
export const criterionDirections = ["at_least", "at_most"] as const;
export type CriterionDirection = (typeof criterionDirections)[number];

export interface GoalCriterion {
  readonly id: string;
  readonly goalId: string;
  /** Stable machine key, e.g. `emergency_reserve`. Unique within a goal. */
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly unit: CriterionUnit;
  readonly direction: CriterionDirection;
  /** The value at which this criterion is GREEN. */
  readonly greenThreshold: number;
  /** The value at which this criterion stops being RED. Between red and green. */
  readonly yellowThreshold: number;
  /**
   * Where progress started, for `at_most` criteria whose target is 0 (debt
   * payoff). Without it, "how far along am I?" is undefined.
   */
  readonly baselineValue?: number;
  readonly currentValue: number;
  /**
   * A blocking criterion vetoes the whole goal: if it is RED, the goal is RED
   * no matter how good everything else looks. Insurance affordability on a
   * vehicle purchase is blocking; a nice-to-have cash buffer is not.
   */
  readonly blocking: boolean;
  /** Relative contribution to the weighted score. Defaults to 1. */
  readonly weight: number;
  readonly lastMeasuredAt?: string;
  /** `manual`, or the integration that measured it. */
  readonly source: string;
}

export interface Goal {
  readonly id: string;
  readonly userId: string;
  readonly domain: Domain;
  /** Stable machine key, e.g. `move_out`. */
  readonly slug: string;
  readonly title: string;
  readonly description?: string;
  readonly status: GoalStatus;
  readonly targetDate?: string;
  /** Ordering hint for the dashboard; not a priority score. */
  readonly displayOrder: number;
  readonly criteria: readonly GoalCriterion[];
  readonly createdAt: string;
  readonly updatedAt?: string;
}

/** A single measurement of a criterion. The append-only history behind a goal. */
export interface GoalCriterionReading {
  readonly id: string;
  readonly userId: string;
  readonly criterionId: string;
  readonly value: number;
  readonly recordedAt: string;
  readonly source: string;
  readonly note?: string;
}

// --- Readiness output --------------------------------------------------------

export interface CriterionReadiness {
  readonly criterionId: string;
  readonly key: string;
  readonly label: string;
  readonly unit: CriterionUnit;
  readonly level: ReadinessLevel;
  /** 0..1 progress toward GREEN. */
  readonly progress: number;
  readonly currentValue: number;
  readonly greenThreshold: number;
  readonly yellowThreshold: number;
  readonly blocking: boolean;
  readonly weight: number;
  /** Distance to the next level, in the criterion's own unit. 0 when GREEN. */
  readonly gapToNextLevel: number;
  readonly gapToGreen: number;
}

export interface GoalReadiness {
  readonly goalId: string;
  readonly level: ReadinessLevel;
  /** Weighted 0..1 score. Shown as supporting detail, never as the verdict. */
  readonly score: number;
  readonly criteria: readonly CriterionReadiness[];
  /** Criteria keeping the goal below GREEN, worst first. */
  readonly blockers: readonly CriterionReadiness[];
  /** Plain-language reason for the level, suitable for display verbatim. */
  readonly rationale: string;
}

export const readinessLevelSchema = z.enum(readinessLevels);

export const goalDraftSchema = z.object({
  domain: z.enum(domains),
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9_]+$/, "Use lowercase letters, digits and underscores"),
  title: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  targetDate: z.iso.date().optional(),
  displayOrder: z.number().int().min(0).default(0),
});

export type GoalDraft = z.infer<typeof goalDraftSchema>;
