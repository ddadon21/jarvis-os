/** 1-minute OHLCV bar. `t` is the bar OPEN time in epoch milliseconds (UTC). */
export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };

/** A journaled trade used as a training label (from trading_trades). */
export type LabeledTrade = {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  openedAt: string;
  preparedAt: string | null;
  closedAt: string | null;
  entryPrice: number | null;
  exitPrice: number | null;
  initialStop: number | null;
  initialTarget: number | null;
  realizedPnl: number | null;
};

export type Side = "LONG" | "SHORT";

export type Condition = { feature: string; op: "<=" | ">"; value: number };
export type Rule = { side: Side; conditions: Condition[]; trainPrecision: number; trainSupport: number };

export type SignalPoint = { index: number; t: number; side: Side; price: number };

export type SideMetrics = {
  entries: number;
  signals: number;
  matched: number;
  recall: number;
  precision: number;
  signalsPerDay: number;
  avgR: number | null;
  totalR: number | null;
};

export type EvaluationMetrics = {
  days: number;
  long: SideMetrics;
  short: SideMetrics;
  combined: { recall: number; precision: number; signalsPerDay: number; avgR: number | null; totalR: number | null };
};
