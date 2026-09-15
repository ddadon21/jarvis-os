import type { MinorUnits } from "@/core/types";
import type { AccountMode, TradingPerformance } from "@/domains/trading/types";

/**
 * What the Trading domain needs in order to answer core's two questions.
 *
 * Narrow on purpose. The module does not get a general database handle; it gets
 * exactly the reads it needs. When Tradovate and TradeLocker arrive they
 * implement this interface behind a provider adapter, and nothing above this
 * line changes.
 */

export interface TradingSnapshot {
  readonly mode: AccountMode;
  readonly accountCount: number;
  readonly openPositions: number;
  /** Trades captured so far. The dataset size is the leading indicator here. */
  readonly datasetSize: number;
  readonly performance: TradingPerformance;
  /** Trades recorded but still missing context, reasoning or screenshots. */
  readonly unjournaledTrades: number;
  /** Signals that fired and were not taken, in the current window. */
  readonly skippedSetups: number;
  /** 0..1 — how much of the user's process the model can currently reproduce. */
  readonly modelConfidence: number;
  readonly equity: MinorUnits;
  readonly observedAt: string;
}

export interface TradingSource {
  getSnapshot(userId: string): Promise<TradingSnapshot>;
}
