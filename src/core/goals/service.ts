import type { Domain, ReadinessLevel } from "@/core/types";
import type { Goal, GoalReadiness } from "@/core/goals/types";
import type { GoalRepository } from "@/core/goals/ports";
import { computeGoalReadiness, rollupReadiness } from "@/core/goals/readiness";

export interface GoalWithReadiness {
  readonly goal: Goal;
  readonly readiness: GoalReadiness;
}

/**
 * The Goal Engine.
 *
 * Readiness is computed on read rather than stored. Criteria values move for
 * reasons outside any single write path — a balance changes, a month of income
 * history accrues — so a cached level would be wrong more often than not. When
 * the criteria count grows enough for this to cost something, cache the
 * computation, not the verdict.
 */
export class GoalService {
  constructor(private readonly repository: GoalRepository) {}

  async list(userId: string, filter?: { domain?: Domain }): Promise<GoalWithReadiness[]> {
    const goals = await this.repository.list(userId, { ...filter, status: "active" });
    return goals
      .map((goal) => ({ goal, readiness: computeGoalReadiness(goal) }))
      .sort((a, b) => a.goal.displayOrder - b.goal.displayOrder);
  }

  async findBySlug(userId: string, slug: string): Promise<GoalWithReadiness | null> {
    const goal = await this.repository.findBySlug(userId, slug);
    return goal ? { goal, readiness: computeGoalReadiness(goal) } : null;
  }

  /** Worst-level rollup across a set of goals, for domain headline panels. */
  async domainReadiness(userId: string, domain: Domain): Promise<ReadinessLevel> {
    const goals = await this.list(userId, { domain });
    return rollupReadiness(goals.map((g) => g.readiness.level));
  }
}
