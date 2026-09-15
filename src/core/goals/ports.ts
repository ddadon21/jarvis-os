import type { Domain } from "@/core/types";
import type { Goal, GoalCriterionReading } from "@/core/goals/types";

export interface GoalRepository {
  /** Goals with their criteria attached. */
  list(userId: string, filter?: { domain?: Domain; status?: Goal["status"] }): Promise<Goal[]>;
  findBySlug(userId: string, slug: string): Promise<Goal | null>;
  /** Append-only measurement history for a criterion. */
  recordReading(reading: GoalCriterionReading): Promise<GoalCriterionReading>;
  readings(userId: string, criterionId: string, limit?: number): Promise<GoalCriterionReading[]>;
}
