import { durableRead, durableWrite } from "./jarvis-db";
import { sessionDay } from "./trading-session";
import { changedTrades, diffTradingStates } from "./trading-lifecycle";
import type { JournalTrade, TradingRuntimeState } from "./trading-runtime";

export type { TradeEvent, TradeEventType } from "./trading-lifecycle";

/**
 * Durable trading lifecycle store.
 *
 * Without broker API access, the Observer is the source of truth for what
 * Dwight did. Every state change becomes an append-only event so the
 * learning pipeline can later reconstruct prepare → entry → management → exit.
 */

function tradeRow(trade: JournalTrade, workspaceId: string) {
  return {
    id: trade.id,
    workspace_id: workspaceId,
    symbol: trade.symbol,
    side: trade.side,
    quantity: trade.quantity,
    max_quantity: trade.maxQuantity ?? trade.quantity,
    status: trade.status,
    entry_price: trade.entryPrice,
    exit_price: trade.exitPrice,
    initial_stop: trade.initialStop ?? trade.stopPrice,
    initial_target: trade.initialTarget ?? trade.targetPrice,
    stop_price: trade.stopPrice,
    target_price: trade.targetPrice,
    opened_at: trade.openedAt,
    closed_at: trade.closedAt,
    session_day: trade.sessionDay ?? sessionDay(trade.openedAt),
    realized_pnl: trade.realizedPnl,
    pnl_source: trade.pnlSource ?? null,
    mfe_price: trade.mfePrice ?? null,
    mae_price: trade.maePrice ?? null,
    prepared_at: trade.preparedAt ?? null,
    source: trade.source,
    notes: trade.notes,
    metadata: {
      setup: trade.setup,
      htfBias: trade.htfBias,
      liquidityContext: trade.liquidityContext,
      zoneContext: trade.zoneContext,
      confirmation: trade.confirmation,
      followedRules: trade.followedRules,
      externalId: trade.externalId,
    },
    updated_at: new Date().toISOString(),
  };
}

const SNAPSHOT_INTERVAL_MS = 15_000;
let lastSnapshotAt = 0;
let lastSnapshotKey = "";

export async function persistTradingTransition(previous: TradingRuntimeState, next: TradingRuntimeState) {
  const events = diffTradingStates(previous, next);
  const trades = changedTrades(previous, next);
  const writes: Array<Promise<boolean>> = [];

  if (trades.length) {
    writes.push(durableWrite("trading_trades", ({ db, workspaceId }) =>
      db.from("trading_trades").upsert(trades.map((trade) => tradeRow(trade, workspaceId)), { onConflict: "id" }),
    ));
  }
  if (events.length) {
    writes.push(durableWrite("trading_trade_events", ({ db, workspaceId }) =>
      db.from("trading_trade_events").insert(events.map((event) => ({
        workspace_id: workspaceId,
        trade_id: event.tradeId,
        type: event.type,
        at: event.at,
        symbol: event.symbol,
        side: event.side,
        quantity: event.quantity,
        price: event.price,
        stop_price: event.stopPrice,
        target_price: event.targetPrice,
        open_pnl: event.openPnl,
        confidence: event.confidence,
        payload: event.payload ?? {},
      }))),
    ));
  }

  const observer = next.observer;
  if (observer?.observedAt) {
    const key = [observer.status, observer.intentState, observer.symbol, observer.side, observer.quantity, observer.entryPrice, observer.stopPrice, observer.targetPrice].join("|");
    const now = Date.now();
    if (key !== lastSnapshotKey || now - lastSnapshotAt >= SNAPSHOT_INTERVAL_MS) {
      lastSnapshotKey = key;
      lastSnapshotAt = now;
      writes.push(durableWrite("trading_observer_snapshots", ({ db, workspaceId }) =>
        db.from("trading_observer_snapshots").insert({
          workspace_id: workspaceId,
          observed_at: observer.observedAt,
          connection: next.account.connection,
          status: observer.status,
          intent_state: observer.intentState ?? null,
          symbol: observer.symbol,
          side: observer.side,
          quantity: observer.quantity,
          order_type: observer.orderType,
          entry_price: observer.entryPrice,
          current_price: observer.currentPrice,
          stop_price: observer.stopPrice,
          target_price: observer.targetPrice,
          open_pnl: observer.openPnl,
          confidence: observer.confidence,
          evidence: observer.evidence ?? [],
        }),
      ));
    }
  }

  await Promise.all(writes);
  return { events: events.length, trades: trades.length };
}

export type StoredTrade = {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  quantity: number;
  status: "OPEN" | "CLOSED";
  entry_price: number | null;
  exit_price: number | null;
  initial_stop: number | null;
  initial_target: number | null;
  stop_price: number | null;
  target_price: number | null;
  opened_at: string;
  closed_at: string | null;
  session_day: string;
  realized_pnl: number | null;
  pnl_source: string | null;
  mfe_price: number | null;
  mae_price: number | null;
  prepared_at: string | null;
};

export async function listStoredTrades(options: { since?: string; limit?: number } = {}): Promise<StoredTrade[] | null> {
  return durableRead<StoredTrade[]>("trading_trades", ({ db, workspaceId }) => {
    let query = db.from("trading_trades")
      .select("id,symbol,side,quantity,status,entry_price,exit_price,initial_stop,initial_target,stop_price,target_price,opened_at,closed_at,session_day,realized_pnl,pnl_source,mfe_price,mae_price,prepared_at")
      .eq("workspace_id", workspaceId)
      .order("opened_at", { ascending: false })
      .limit(Math.min(5000, options.limit ?? 500));
    if (options.since) query = query.gte("opened_at", options.since);
    return query;
  });
}

let countMemo: { value: number | null; at: number } | null = null;

export async function countStoredTrades(): Promise<number | null> {
  if (countMemo && Date.now() - countMemo.at < 30_000) return countMemo.value;
  const result = await durableRead<{ count: number }>("trading_trades", async ({ db, workspaceId }) => {
    const { count, error } = await db.from("trading_trades").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
    return { data: { count: count ?? 0 }, error };
  });
  countMemo = { value: result?.count ?? null, at: Date.now() };
  return countMemo.value;
}
