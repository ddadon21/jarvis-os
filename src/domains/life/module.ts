import type { DomainContext, DomainModule } from "@/core/domain-module";
import type { MoveCandidate } from "@/core/next-move/types";
import type { WorldStateSlice } from "@/core/world-state/types";
import { factors } from "@/core/next-move/scoring";
import type { LifeSource } from "@/domains/life/ports";

/**
 * Life Jarvis.
 *
 * The smallest domain by design. It exists to stop personal decisions from
 * being made in isolation from financial reality — not to track habits, streaks
 * or routines. If a feature here would work equally well in a habit app, it
 * does not belong.
 */
export class LifeModule implements DomainModule {
  readonly domain = "life" as const;
  readonly mission =
    "Keep commitments, major purchases and long-term plans aligned with what the financial and business picture actually supports.";

  constructor(private readonly source: LifeSource) {}

  async getStateSlice(context: DomainContext): Promise<WorldStateSlice> {
    const snapshot = await this.source.getSnapshot(context.userId);
    const next = snapshot.upcomingCommitments[0];

    return {
      domain: this.domain,
      headline: next
        ? `Next: ${next.title}`
        : "No commitments on the calendar.",
      metrics: [
        {
          key: "upcoming_commitments",
          label: "Upcoming",
          value: snapshot.upcomingCommitments.length,
          format: "number",
          polarity: "neutral",
          caption: "next 7 days",
        },
        {
          key: "open_decisions",
          label: "Open decisions",
          value: snapshot.openDecisions.length,
          format: "number",
          polarity: "neutral",
        },
        {
          key: "unaccounted_cost",
          label: "Unbudgeted cost",
          value: snapshot.unaccountedCommitmentCost,
          format: "currency",
          polarity: "lower_is_better",
          caption: "committed but not in the finance model",
        },
      ],
      dataQuality: "mock",
      observedAt: snapshot.observedAt,
    };
  }

  async proposeMoves(context: DomainContext): Promise<MoveCandidate[]> {
    const snapshot = await this.source.getSnapshot(context.userId);
    const moves: MoveCandidate[] = [];

    if (snapshot.unaccountedCommitmentCost > 0) {
      moves.push({
        id: "life.reconcile_commitment_costs",
        userId: context.userId,
        domain: this.domain,
        title: "Reconcile committed costs with the finance model",
        summary:
          "Committed spending that Finance cannot see makes every readiness meter optimistic — the failure mode this domain exists to prevent.",
        requiredActionLevel: "recommend",
        sourceKind: "agent",
        sourceId: "life.chief_of_staff",
        factors: factors({
          urgency: 0.4,
          expectedValue: snapshot.unaccountedCommitmentCost,
          goalAlignment: 0.7,
          strategicImportance: 0.6,
          contextFit: 0.5,
          probabilityOfSuccess: 0.9,
          estimatedMinutes: 15,
        }),
      });
    }

    return moves;
  }
}
