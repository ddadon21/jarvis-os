import type { Horizon } from "@/core/types";
import type { DomainContext, DomainModule } from "@/core/domain-module";
import type { MoveCandidate, NextMoveWeights, ScoredMove } from "@/core/next-move/types";
import { DEFAULT_WEIGHTS, groupByHorizon, rankMoves } from "@/core/next-move/scoring";

/**
 * The Next Move Engine.
 *
 * Collects candidates from every domain and ranks them on one comparable
 * scale. This is the only place in Jarvis where a trade review and a debt
 * payment compete directly — which is exactly the comparison the user needs
 * and the hardest one to make by hand.
 */
export class NextMoveService {
  constructor(
    private readonly modules: readonly DomainModule[],
    private readonly weights: NextMoveWeights = DEFAULT_WEIGHTS,
  ) {}

  async candidates(context: DomainContext): Promise<MoveCandidate[]> {
    const results = await Promise.allSettled(this.modules.map((module) => module.proposeMoves(context)));

    // A domain that cannot propose moves must not blank the whole list.
    return results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  }

  async rank(context: DomainContext): Promise<ScoredMove[]> {
    const candidates = await this.candidates(context);
    return rankMoves(candidates, this.weights, context.now);
  }

  /** The single highest-leverage action, or null when nothing is proposed. */
  async nextMove(context: DomainContext): Promise<ScoredMove | null> {
    const ranked = await this.rank(context);
    return ranked[0] ?? null;
  }

  async byHorizon(context: DomainContext): Promise<Record<Horizon, ScoredMove[]>> {
    return groupByHorizon(await this.rank(context));
  }
}
