import type { JournalTrade, TradingObserverState, TradingRuntimeState } from "./trading-runtime";

/**
 * Pure lifecycle diff: turns two consecutive trading runtime states into the
 * append-only events the learning pipeline needs (prepare -> entry -> manage -> exit).
 */


export type TradeEventType =
  | "PREPARING"
  | "ORDER_WORKING"
  | "ORDER_CANCELLED"
  | "ENTRY"
  | "STOP_MOVED"
  | "TARGET_MOVED"
  | "SIZE_CHANGED"
  | "EXIT";

export type TradeEvent = {
  tradeId: string | null;
  type: TradeEventType;
  at: string;
  symbol: string | null;
  side: "LONG" | "SHORT" | null;
  quantity: number | null;
  price: number | null;
  stopPrice: number | null;
  targetPrice: number | null;
  openPnl: number | null;
  confidence: number | null;
  payload?: Record<string, unknown>;
};


function changed(a: number | null | undefined, b: number | null | undefined) {
  if (a == null && b == null) return false;
  if (a == null || b == null) return true;
  return Math.abs(a - b) > 1e-6;
}

function isPreparing(observer: TradingObserverState | undefined) {
  return observer?.intentState === "PREPARING" && observer.status !== "OPEN" && observer.status !== "PENDING";
}

/** Pure diff of two runtime states into lifecycle events. Exported for tests. */
export function diffTradingStates(previous: TradingRuntimeState, next: TradingRuntimeState): TradeEvent[] {
  const events: TradeEvent[] = [];
  const at = next.observer?.observedAt ?? next.account.lastObservedAt ?? new Date().toISOString();
  const prior = previous.observer;
  const current = next.observer;
  const base = (observer: TradingObserverState | undefined, tradeId: string | null) => ({
    tradeId,
    at,
    symbol: observer?.symbol ?? null,
    side: observer?.side ?? null,
    quantity: observer?.quantity ?? null,
    price: observer?.entryPrice ?? null,
    stopPrice: observer?.stopPrice ?? null,
    targetPrice: observer?.targetPrice ?? null,
    openPnl: observer?.openPnl ?? null,
    confidence: observer?.confidence ?? null,
  });

  const openNow = next.openTrades[0] ?? null;

  if (current && isPreparing(current) && !isPreparing(prior)) {
    events.push({ ...base(current, null), type: "PREPARING" });
  }
  if (current?.status === "PENDING" && prior?.status !== "PENDING") {
    events.push({ ...base(current, null), type: "ORDER_WORKING" });
  }
  const priorStaged = prior?.status === "PENDING" || isPreparing(prior);
  const nowIdle = current && current.status !== "OPEN" && current.status !== "PENDING" && !isPreparing(current);
  if (priorStaged && nowIdle && !openNow) {
    events.push({ ...base(prior, null), at, type: "ORDER_CANCELLED" });
  }

  const priorIds = new Map([...previous.openTrades, ...previous.recentTrades].map((trade) => [trade.id, trade]));
  for (const trade of next.openTrades) {
    const before = priorIds.get(trade.id);
    if (!before) {
      events.push({
        tradeId: trade.id, type: "ENTRY", at: trade.openedAt, symbol: trade.symbol, side: trade.side,
        quantity: trade.quantity, price: trade.entryPrice, stopPrice: trade.stopPrice, targetPrice: trade.targetPrice,
        openPnl: null, confidence: current?.confidence ?? null,
      });
      continue;
    }
    if (changed(before.stopPrice, trade.stopPrice)) {
      events.push({ ...base(current, trade.id), type: "STOP_MOVED", stopPrice: trade.stopPrice, payload: { from: before.stopPrice } });
    }
    if (changed(before.targetPrice, trade.targetPrice)) {
      events.push({ ...base(current, trade.id), type: "TARGET_MOVED", targetPrice: trade.targetPrice, payload: { from: before.targetPrice } });
    }
    if (changed(before.quantity, trade.quantity)) {
      events.push({ ...base(current, trade.id), type: "SIZE_CHANGED", quantity: trade.quantity, payload: { from: before.quantity } });
    }
  }
  for (const trade of next.recentTrades) {
    const before = priorIds.get(trade.id);
    if (before && before.status === "OPEN") {
      events.push({
        tradeId: trade.id, type: "EXIT", at: trade.closedAt ?? at, symbol: trade.symbol, side: trade.side,
        quantity: before.quantity, price: trade.exitPrice, stopPrice: before.stopPrice, targetPrice: before.targetPrice,
        openPnl: null, confidence: current?.confidence ?? null,
        payload: { realizedPnl: trade.realizedPnl, pnlSource: trade.pnlSource ?? null },
      });
    }
  }
  return events;
}

/** Trades whose stored row needs an upsert after this transition. */
export function changedTrades(previous: TradingRuntimeState, next: TradingRuntimeState): JournalTrade[] {
  const prior = new Map([...previous.openTrades, ...previous.recentTrades].map((trade) => [trade.id, JSON.stringify(trade)]));
  return [...next.openTrades, ...next.recentTrades].filter((trade) => prior.get(trade.id) !== JSON.stringify(trade));
}

