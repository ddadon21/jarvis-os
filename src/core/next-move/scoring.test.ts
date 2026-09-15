import { describe, expect, it } from "vitest";
import {
  BLOCKED_PENALTY,
  factors,
  groupByHorizon,
  normalizeExpectedValue,
  rankMoves,
  resolveHorizon,
  scoreCandidate,
} from "@/core/next-move/scoring";
import type { MoveCandidate, MoveFactors } from "@/core/next-move/types";

const NOW = new Date("2026-03-02T14:00:00.000Z");

type CandidateOverrides = Omit<Partial<MoveCandidate>, "factors"> & {
  id: string;
  factors?: Partial<MoveFactors>;
};

function candidate(overrides: CandidateOverrides): MoveCandidate {
  return {
    userId: "user-1",
    domain: "core",
    title: overrides.id,
    requiredActionLevel: "recommend",
    sourceKind: "manual",
    ...overrides,
    factors: factors(overrides.factors),
  };
}

describe("scoreCandidate", () => {
  it("ranks a goal-advancing, high-impact move above busywork", () => {
    const meaningful = candidate({
      id: "pay-down-card",
      factors: { goalAlignment: 1, expectedValue: 120_000, strategicImportance: 0.7, urgency: 0.5 },
    });
    const busywork = candidate({
      id: "reorganise-notes",
      factors: { goalAlignment: 0.1, strategicImportance: 0.1, urgency: 0.2, estimatedMinutes: 90 },
    });

    expect(scoreCandidate(meaningful, undefined, NOW).score).toBeGreaterThan(
      scoreCandidate(busywork, undefined, NOW).score,
    );
  });

  it("does not let urgency alone win", () => {
    const urgentTrivia = candidate({
      id: "urgent-trivia",
      factors: { urgency: 1, goalAlignment: 0, strategicImportance: 0 },
    });
    // Urgency is capped at its weight (0.16); nothing urgent-but-pointless
    // should reach the NOW threshold on its own.
    expect(scoreCandidate(urgentTrivia, undefined, NOW).horizon).not.toBe("now");
  });

  it("scales the score by probability of success", () => {
    const base = { goalAlignment: 1, strategicImportance: 1, urgency: 1, expectedValue: 500_000 };
    const likely = scoreCandidate(candidate({ id: "likely", factors: { ...base, probabilityOfSuccess: 1 } }), undefined, NOW);
    const longShot = scoreCandidate(
      candidate({ id: "long-shot", factors: { ...base, probabilityOfSuccess: 0.2 } }),
      undefined,
      NOW,
    );

    expect(longShot.score).toBeLessThan(likely.score * 0.5);
    expect(longShot.rationale).toContain("20%");
  });

  it("penalises blocked candidates and refuses to place them at NOW", () => {
    const strong = { goalAlignment: 1, strategicImportance: 1, urgency: 1, expectedValue: 2_500_000, probabilityOfSuccess: 1 };
    const open = scoreCandidate(candidate({ id: "open", factors: strong }), undefined, NOW);
    const blocked = scoreCandidate(
      candidate({ id: "blocked", blocked: true, dependsOn: ["other"], factors: strong }),
      undefined,
      NOW,
    );

    expect(open.horizon).toBe("now");
    expect(blocked.score).toBeCloseTo(open.score * BLOCKED_PENALTY, 3);
    expect(blocked.horizon).not.toBe("now");
    expect(blocked.rationale).toContain("dependency");
  });

  it("explains itself with the dominant factors first", () => {
    const move = scoreCandidate(
      candidate({ id: "explained", factors: { goalAlignment: 1, risk: 1, estimatedMinutes: 240 } }),
      undefined,
      NOW,
    );
    expect(move.contributions[0]?.factor).toBe("goalAlignment");
    expect(move.rationale).toContain("goal alignment");
    expect(move.rationale).toContain("Held back by");
  });
});

describe("resolveHorizon", () => {
  it("lets a deadline pull a move earlier than its score would place it", () => {
    const weak = candidate({ id: "weak", factors: { goalAlignment: 0.1 }, dueAt: "2026-03-02T15:00:00.000Z" });
    expect(resolveHorizon(weak, 0.2, NOW)).toBe("now");
  });

  it("never lets a deadline push a strong move later", () => {
    const strong = candidate({ id: "strong", dueAt: "2027-01-01T00:00:00.000Z" });
    expect(resolveHorizon(strong, 0.9, NOW)).toBe("now");
  });

  it("ignores an unparseable deadline rather than throwing", () => {
    const broken = candidate({ id: "broken", dueAt: "not-a-date" });
    expect(resolveHorizon(broken, 0.5, NOW)).toBe("today");
  });
});

describe("normalizeExpectedValue", () => {
  it("is logarithmic, so small wins are not rounded away", () => {
    const small = normalizeExpectedValue(5_000);
    const medium = normalizeExpectedValue(500_000);
    const large = normalizeExpectedValue(5_000_000);

    expect(small).toBeGreaterThan(0.2);
    expect(medium).toBeGreaterThan(small);
    expect(large).toBeLessThanOrEqual(1);
    expect(large - medium).toBeLessThan(medium - small);
  });

  it("treats a missing value as neutral", () => {
    expect(normalizeExpectedValue(undefined)).toBe(0);
  });
});

describe("rankMoves / groupByHorizon", () => {
  it("returns every candidate exactly once across horizon buckets", () => {
    const moves = rankMoves(
      [
        candidate({ id: "a", factors: { goalAlignment: 1, expectedValue: 1_000_000 } }),
        candidate({ id: "b", factors: { goalAlignment: 0.2 } }),
        candidate({ id: "c", factors: { urgency: 0.9 }, dueAt: "2026-03-02T14:30:00.000Z" }),
      ],
      undefined,
      NOW,
    );

    const grouped = groupByHorizon(moves);
    const total = Object.values(grouped).reduce((sum, bucket) => sum + bucket.length, 0);
    expect(total).toBe(3);
    expect(moves[0]?.score).toBeGreaterThanOrEqual(moves[1]?.score ?? 0);
  });
});
