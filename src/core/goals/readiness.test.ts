import { describe, expect, it } from "vitest";
import { computeGoalReadiness, criterionProgress, rollupReadiness } from "@/core/goals/readiness";
import type { Goal, GoalCriterion } from "@/core/goals/types";

function criterion(overrides: Partial<GoalCriterion> & Pick<GoalCriterion, "key">): GoalCriterion {
  return {
    id: `criterion-${overrides.key}`,
    goalId: "goal-1",
    label: overrides.key,
    unit: "currency",
    direction: "at_least",
    greenThreshold: 100,
    yellowThreshold: 50,
    currentValue: 0,
    blocking: false,
    weight: 1,
    source: "test",
    ...overrides,
  };
}

function goal(criteria: GoalCriterion[]): Goal {
  return {
    id: "goal-1",
    userId: "user-1",
    domain: "finance",
    slug: "test_goal",
    title: "Test goal",
    status: "active",
    displayOrder: 0,
    criteria,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("computeGoalReadiness", () => {
  it("is RED with no criteria, because unmeasured is not ready", () => {
    const result = computeGoalReadiness(goal([]));
    expect(result.level).toBe("red");
    expect(result.score).toBe(0);
  });

  it("is GREEN only when every criterion is green", () => {
    const result = computeGoalReadiness(
      goal([
        criterion({ key: "a", currentValue: 100 }),
        criterion({ key: "b", currentValue: 150 }),
      ]),
    );
    expect(result.level).toBe("green");
    expect(result.blockers).toHaveLength(0);
  });

  it("never reaches GREEN on a high average while one criterion is short", () => {
    const result = computeGoalReadiness(
      goal([
        criterion({ key: "a", currentValue: 100, weight: 9 }),
        criterion({ key: "b", currentValue: 10, weight: 1 }),
      ]),
    );
    expect(result.score).toBeGreaterThan(0.9);
    expect(result.level).toBe("yellow");
  });

  it("is RED when a blocking criterion is red, however good the score", () => {
    const result = computeGoalReadiness(
      goal([
        criterion({ key: "cash", currentValue: 100, weight: 20 }),
        criterion({ key: "insurance", currentValue: 0, blocking: true, weight: 1 }),
      ]),
    );
    expect(result.level).toBe("red");
    expect(result.blockers[0]?.key).toBe("insurance");
    expect(result.rationale).toContain("Blocked by a required criterion");
  });

  it("is RED below the 50% weighted floor even with no red-blocking criterion", () => {
    const result = computeGoalReadiness(
      goal([
        criterion({ key: "a", currentValue: 60 }),
        criterion({ key: "b", currentValue: 10 }),
      ]),
    );
    expect(result.score).toBeLessThan(0.5);
    expect(result.level).toBe("red");
  });

  it("orders blockers with blocking criteria first, then by severity", () => {
    const result = computeGoalReadiness(
      goal([
        criterion({ key: "yellow_one", currentValue: 60 }),
        criterion({ key: "red_one", currentValue: 20 }),
        criterion({ key: "blocking_yellow", currentValue: 60, blocking: true }),
      ]),
    );
    expect(result.blockers.map((b) => b.key)).toEqual(["blocking_yellow", "red_one", "yellow_one"]);
  });

  it("reports the gap to the next level in the criterion's own unit", () => {
    const result = computeGoalReadiness(goal([criterion({ key: "reserve", currentValue: 30 })]));
    const reserve = result.criteria[0];
    expect(reserve?.gapToNextLevel).toBe(20); // 30 -> yellow at 50
    expect(reserve?.gapToGreen).toBe(70); // 30 -> green at 100
  });
});

describe("criterionProgress", () => {
  it("measures at_most payoff progress from the baseline", () => {
    const debt = criterion({
      key: "debt",
      direction: "at_most",
      greenThreshold: 0,
      yellowThreshold: 200_000,
      baselineValue: 1_400_000,
      currentValue: 700_000,
    });
    expect(criterionProgress(debt)).toBeCloseTo(0.5);
  });

  it("treats a met at_most target as complete", () => {
    const utilization = criterion({
      key: "utilization",
      unit: "percent",
      direction: "at_most",
      greenThreshold: 0.1,
      yellowThreshold: 0.3,
      currentValue: 0.05,
    });
    expect(criterionProgress(utilization)).toBe(1);
  });

  it("falls back to a ratio for at_most criteria with no baseline", () => {
    const utilization = criterion({
      key: "utilization",
      unit: "percent",
      direction: "at_most",
      greenThreshold: 0.1,
      yellowThreshold: 0.3,
      currentValue: 0.4,
    });
    expect(criterionProgress(utilization)).toBeCloseTo(0.25);
  });

  it("clamps overshoot to 1", () => {
    expect(criterionProgress(criterion({ key: "a", currentValue: 500 }))).toBe(1);
  });
});

describe("rollupReadiness", () => {
  it("takes the worst level", () => {
    expect(rollupReadiness(["green", "yellow", "red"])).toBe("red");
    expect(rollupReadiness(["green", "yellow"])).toBe("yellow");
    expect(rollupReadiness(["green", "green"])).toBe("green");
  });

  it("treats an empty set as RED rather than vacuously green", () => {
    expect(rollupReadiness([])).toBe("red");
  });
});
