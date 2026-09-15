import type { Confidence, MinorUnits } from "@/core/types";

/**
 * Trading domain types.
 *
 * These describe the shape of the trading dataset Jarvis is being built to
 * accumulate. The tables behind them are specified in docs/DATABASE.md and are
 * NOT migrated in v0.1 — the schema should be written once there is a real
 * broker feed to shape it, not guessed at now. What matters today is that the
 * vocabulary is fixed, because it determines what can be measured in two years.
 *
 * The dataset is the product. A trade row that is missing its context is a row
 * that can never answer "under what conditions does this setup actually work?".
 */

export const tradeDirections = ["long", "short"] as const;
export type TradeDirection = (typeof tradeDirections)[number];

export const tradeStatuses = ["open", "closed", "cancelled"] as const;
export type TradeStatus = (typeof tradeStatuses)[number];

/** Where the record came from. Paper and live are never mixed in analysis. */
export const accountModes = ["live", "paper", "sim", "backtest"] as const;
export type AccountMode = (typeof accountModes)[number];

export const sessions = ["asia", "london", "ny_am", "ny_pm", "overnight"] as const;
export type Session = (typeof sessions)[number];

export const htfBiases = ["bullish", "bearish", "neutral", "unclear"] as const;
export type HtfBias = (typeof htfBiases)[number];

export interface TradingAccount {
  readonly id: string;
  readonly userId: string;
  readonly label: string;
  /** `tradovate`, `tradelocker`, `tradingview`, `manual`, … */
  readonly platform: string;
  readonly broker?: string;
  readonly mode: AccountMode;
  readonly currency: string;
  readonly startingBalance: MinorUnits;
  readonly currentBalance: MinorUnits;
  readonly active: boolean;
}

/** A single fill. A trade is composed of one or more of these. */
export interface TradeExecution {
  readonly id: string;
  readonly tradeId: string;
  readonly side: "buy" | "sell";
  readonly quantity: number;
  /** Instrument price, not money — scaled by the instrument's tick value. */
  readonly price: number;
  readonly executedAt: string;
  readonly fees?: MinorUnits;
  /** Broker's own id, for reconciliation. */
  readonly externalId?: string;
}

/**
 * Market conditions around a trade, captured whether or not a trade was taken.
 * Skipped setups need this just as much — they are the control group.
 */
export interface MarketContext {
  readonly id: string;
  readonly instrument: string;
  readonly observedAt: string;
  readonly session: Session;
  readonly dayOfWeek: number;
  readonly htfBias: HtfBias;
  /** Named supply/demand or order-block zones in play. */
  readonly zones: readonly string[];
  /** Liquidity levels being watched, e.g. `PDH`, `PDL`, `Asia high`. */
  readonly liquidityLevels: readonly string[];
  readonly sweptLevels: readonly string[];
  readonly gaps: readonly string[];
  readonly inverseGaps: readonly string[];
  readonly notes?: string;
  /** Economic calendar items within the window. */
  readonly newsEvents?: readonly string[];
}

export interface IndicatorEvent {
  readonly id: string;
  readonly userId: string;
  readonly instrument: string;
  /** Which version of the user's indicator produced it. */
  readonly indicatorVersion: string;
  readonly signalType: string;
  readonly firedAt: string;
  readonly direction?: TradeDirection;
  readonly strength?: Confidence;
  /** The trade taken on this signal, if any. Null is meaningful data. */
  readonly tradeId?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface TradeSetup {
  readonly id: string;
  readonly userId: string;
  readonly key: string;
  readonly name: string;
  readonly description: string;
  /** The user's own grading. Compared against measured expectancy, not trusted. */
  readonly userGrade?: "A+" | "A" | "B" | "C";
  readonly rulesVersion: string;
}

export interface Trade {
  readonly id: string;
  readonly userId: string;
  readonly accountId: string;
  readonly instrument: string;
  readonly direction: TradeDirection;
  readonly status: TradeStatus;

  readonly entryPrice: number;
  readonly exitPrice?: number;
  readonly stopLoss?: number;
  readonly targets: readonly number[];
  readonly quantity: number;

  /** Capital risked at entry. The denominator of the R multiple. */
  readonly riskAmount: MinorUnits;
  readonly realizedPnl?: MinorUnits;
  /** Result in R. The unit that makes trades comparable across size. */
  readonly rMultiple?: number;

  readonly openedAt: string;
  readonly closedAt?: string;
  readonly session: Session;

  readonly setupId?: string;
  readonly marketContextId?: string;

  /** The user's own words, captured as close to the decision as possible. */
  readonly reasoning?: string;
  /** Did the execution match the plan? The single most important behavioural field. */
  readonly followedPlan?: boolean;
  readonly planDeviations?: readonly string[];
  readonly screenshotPaths?: readonly string[];
  /** What price did after the exit — the basis for "should I have held?". */
  readonly postTradeNotes?: string;
  readonly mae?: number;
  readonly mfe?: number;
}

/** A skipped setup: a signal or pattern the user saw and chose not to take. */
export interface SkippedSetup {
  readonly id: string;
  readonly userId: string;
  readonly instrument: string;
  readonly observedAt: string;
  readonly setupId?: string;
  readonly reason: string;
  readonly marketContextId?: string;
  /** What the trade would have done. Filled in after the fact. */
  readonly hypotheticalRMultiple?: number;
}

/** Aggregate performance over a window. Computed, never stored as truth. */
export interface TradingPerformance {
  readonly tradeCount: number;
  readonly winRate: number;
  readonly expectancyR: number;
  readonly totalR: number;
  readonly netPnl: MinorUnits;
  readonly maxDrawdownR: number;
  readonly planAdherenceRate: number;
}
