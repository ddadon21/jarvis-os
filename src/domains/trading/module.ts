import type { DomainContext, DomainModule } from "@/core/domain-module";
import type { MoveCandidate } from "@/core/next-move/types";
import type { WorldStateSlice } from "@/core/world-state/types";
import { factors } from "@/core/next-move/scoring";
import type { TradingSnapshot, TradingSource } from "@/domains/trading/ports";

/**
 * Trading Jarvis.
 *
 * Its posture is that of a trading researcher, not a trader: it watches, it
 * records, and it measures. Everything it proposes in v0.1 is about closing
 * gaps in the dataset, because a model of how the user trades cannot exist
 * before the record of how the user trades does.
 */
export class TradingModule implements DomainModule {
  readonly domain = "trading" as const;
  readonly mission =
    "Learn the user's real trading process from evidence, then improve on it — observe, journal, analyse, and only much later trade.";

  constructor(private readonly source: TradingSource) {}

  async getStateSlice(context: DomainContext): Promise<WorldStateSlice> {
    const snapshot = await this.source.getSnapshot(context.userId);

    return {
      domain: this.domain,
      headline: headline(snapshot),
      metrics: [
        {
          key: "expectancy_r",
          label: "Expectancy",
          value: snapshot.performance.expectancyR,
          format: "r_multiple",
          polarity: "higher_is_better",
          caption: `${snapshot.performance.tradeCount} trades in window`,
        },
        {
          key: "dataset_size",
          label: "Dataset",
          value: snapshot.datasetSize,
          format: "number",
          polarity: "higher_is_better",
          caption: "journaled trades",
        },
        {
          key: "model_confidence",
          label: "Model confidence",
          value: snapshot.modelConfidence,
          format: "percent",
          polarity: "higher_is_better",
        },
        {
          key: "plan_adherence",
          label: "Plan adherence",
          value: snapshot.performance.planAdherenceRate,
          format: "percent",
          polarity: "higher_is_better",
        },
        {
          key: "win_rate",
          label: "Win rate",
          value: snapshot.performance.winRate,
          format: "percent",
          polarity: "neutral",
        },
        {
          key: "open_positions",
          label: "Open positions",
          value: snapshot.openPositions,
          format: "number",
          polarity: "neutral",
        },
      ],
      flags: buildFlags(snapshot),
      dataQuality: "mock",
      observedAt: snapshot.observedAt,
    };
  }

  async proposeMoves(context: DomainContext): Promise<MoveCandidate[]> {
    const snapshot = await this.source.getSnapshot(context.userId);
    const moves: MoveCandidate[] = [];

    if (snapshot.unjournaledTrades > 0) {
      moves.push({
        id: "trading.journal_backlog",
        userId: context.userId,
        domain: this.domain,
        title: `Journal ${snapshot.unjournaledTrades} trades missing context`,
        summary:
          "Reasoning and market context decay within hours. A trade journaled from memory next week is a weaker data point than one journaled today.",
        requiredActionLevel: "recommend",
        sourceKind: "agent",
        sourceId: "trading.intelligence",
        factors: factors({
          urgency: 0.7,
          goalAlignment: 0.6,
          strategicImportance: 0.8,
          contextFit: 0.6,
          probabilityOfSuccess: 0.95,
          estimatedMinutes: 10 * snapshot.unjournaledTrades,
        }),
      });
    }

    // Below roughly 100 trades, per-setup expectancy is noise. Saying so is
    // more useful than producing a confident number from 30 samples.
    if (snapshot.datasetSize < 100) {
      moves.push({
        id: "trading.grow_dataset",
        userId: context.userId,
        domain: this.domain,
        title: "Keep growing the trade dataset before drawing conclusions",
        summary: `${snapshot.datasetSize} trades recorded. Per-setup expectancy stays unreliable under ~100.`,
        requiredActionLevel: "observe",
        sourceKind: "agent",
        sourceId: "trading.strategy_scientist",
        factors: factors({
          urgency: 0.2,
          goalAlignment: 0.5,
          strategicImportance: 0.9,
          contextFit: 0.4,
          probabilityOfSuccess: 0.9,
          estimatedMinutes: 0,
        }),
      });
    }

    if (snapshot.performance.planAdherenceRate < 0.8 && snapshot.performance.tradeCount > 0) {
      moves.push({
        id: "trading.review_plan_deviations",
        userId: context.userId,
        domain: this.domain,
        title: "Review trades taken outside the plan",
        summary:
          "Plan adherence is the highest-signal behavioural metric in the dataset. Deviations explain more variance than setup choice.",
        requiredActionLevel: "recommend",
        sourceKind: "agent",
        sourceId: "trading.risk",
        factors: factors({
          urgency: 0.5,
          goalAlignment: 0.6,
          strategicImportance: 0.85,
          contextFit: 0.5,
          probabilityOfSuccess: 0.8,
          estimatedMinutes: 30,
        }),
      });
    }

    return moves;
  }
}

function headline(snapshot: TradingSnapshot): string {
  if (snapshot.datasetSize === 0) return "No trades recorded yet — observation mode.";
  if (snapshot.modelConfidence < 0.6) {
    return `Learning: ${snapshot.datasetSize} trades captured, model confidence ${Math.round(snapshot.modelConfidence * 100)}%.`;
  }
  return `Modelling: ${snapshot.datasetSize} trades, expectancy ${snapshot.performance.expectancyR.toFixed(2)}R.`;
}

function buildFlags(snapshot: TradingSnapshot): string[] {
  const flags: string[] = [snapshot.modelConfidence < 0.6 ? "learning" : "modelling", snapshot.mode];
  if (snapshot.unjournaledTrades > 0) flags.push("journal_backlog");
  if (snapshot.openPositions > 0) flags.push("position_open");
  return flags;
}
