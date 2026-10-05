import { estimatePnl, sessionDay } from "./trading-session";

/** Event emitted by the Windows Observer's local trade journal (TradeJournal.cs). */
export type ObserverJournalEvent = {
  id: string;
  tradeId: string | null;
  type: "PREPARING" | "ORDER_WORKING" | "ORDER_CANCELLED" | "ENTRY" | "STOP_MOVED" | "TARGET_MOVED" | "SIZE_CHANGED" | "EXIT";
  at: string;
  symbol: string | null;
  side: "LONG" | "SHORT" | null;
  quantity: number | null;
  price: number | null;
  stopPrice: number | null;
  targetPrice: number | null;
  currentPrice: number | null;
  pnl: number | null;
  payload?: Record<string, unknown>;
};

const TYPES = new Set(["PREPARING", "ORDER_WORKING", "ORDER_CANCELLED", "ENTRY", "STOP_MOVED", "TARGET_MOVED", "SIZE_CHANGED", "EXIT"]);

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function str(value: unknown, max = 120): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}
function date(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

export function normalizeJournalEvent(input: unknown): ObserverJournalEvent | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const id = str(raw.id, 200);
  const type = str(raw.type, 40);
  const at = date(raw.at);
  if (!id || !type || !TYPES.has(type) || !at) return null;
  const side = raw.side === "LONG" || raw.side === "SHORT" ? raw.side : null;
  return {
    id,
    tradeId: str(raw.tradeId, 200),
    type: type as ObserverJournalEvent["type"],
    at,
    symbol: str(raw.symbol, 40)?.toUpperCase() ?? null,
    side,
    quantity: num(raw.quantity),
    price: num(raw.price),
    stopPrice: num(raw.stopPrice),
    targetPrice: num(raw.targetPrice),
    currentPrice: num(raw.currentPrice),
    pnl: num(raw.pnl),
    payload: raw.payload && typeof raw.payload === "object" ? raw.payload as Record<string, unknown> : {},
  };
}

export type TradePatch = Record<string, unknown> & { id: string };

/**
 * Folds journal events into trade row patches. Each event carries enough
 * context that an EXIT alone (e.g. ENTRY lost) still produces a full row.
 */
export function journalEventsToTradePatches(events: ObserverJournalEvent[], pointOverrides?: Record<string, number>): TradePatch[] {
  const patches = new Map<string, TradePatch>();
  const patch = (id: string) => {
    const existing = patches.get(id);
    if (existing) return existing;
    const created: TradePatch = { id };
    patches.set(id, created);
    return created;
  };
  for (const event of events) {
    if (!event.tradeId) continue;
    const row = patch(event.tradeId);
    const p = event.payload ?? {};
    if (event.symbol) row.symbol = event.symbol;
    if (event.side) row.side = event.side;
    switch (event.type) {
      case "ENTRY":
        row.status = "OPEN";
        row.entry_price = event.price;
        row.opened_at = event.at;
        row.session_day = sessionDay(event.at);
        row.quantity = event.quantity ?? 0;
        row.max_quantity = event.quantity ?? null;
        row.initial_stop = event.stopPrice;
        row.initial_target = event.targetPrice;
        row.stop_price = event.stopPrice;
        row.target_price = event.targetPrice;
        if (date(p.preparedAt)) row.prepared_at = date(p.preparedAt);
        break;
      case "STOP_MOVED":
        row.stop_price = event.stopPrice;
        break;
      case "TARGET_MOVED":
        row.target_price = event.targetPrice;
        break;
      case "SIZE_CHANGED":
        row.quantity = event.quantity ?? 0;
        break;
      case "EXIT": {
        const entry = num(p.entryPrice) ?? (row.entry_price as number | null | undefined) ?? null;
        const openedAt = date(p.openedAt) ?? (row.opened_at as string | undefined) ?? event.at;
        const maxQuantity = num(p.maxQuantity) ?? event.quantity;
        const observedPnl = num(p.realizedPnl);
        const estimated = observedPnl == null
          ? estimatePnl({ symbol: event.symbol, side: event.side, quantity: event.quantity ?? maxQuantity, entryPrice: entry, exitPrice: event.price }, pointOverrides)
          : null;
        row.status = "CLOSED";
        row.exit_price = event.price;
        row.closed_at = event.at;
        row.entry_price = entry;
        row.opened_at = openedAt;
        row.session_day = sessionDay(openedAt);
        row.quantity = event.quantity ?? maxQuantity ?? 0;
        row.max_quantity = maxQuantity;
        row.initial_stop = num(p.initialStop) ?? row.initial_stop ?? null;
        row.initial_target = num(p.initialTarget) ?? row.initial_target ?? null;
        row.stop_price = event.stopPrice;
        row.target_price = event.targetPrice;
        row.realized_pnl = observedPnl ?? estimated;
        row.pnl_source = observedPnl != null ? "OBSERVED" : estimated != null ? "ESTIMATED" : null;
        row.mfe_price = num(p.mfePrice);
        row.mae_price = num(p.maePrice);
        row.prepared_at = date(p.preparedAt) ?? row.prepared_at ?? null;
        break;
      }
      default:
        break;
    }
  }
  return [...patches.values()];
}
