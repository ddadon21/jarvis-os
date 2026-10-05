import { authenticateObserverDevice } from "../../../../lib/trading-device-link";
import { durableContext } from "../../../../lib/jarvis-db";
import { journalEventsToTradePatches, normalizeJournalEvent } from "../../../../lib/trading-journal-sync";
import { getTradingRules } from "../../../../lib/trading-rules";
import { appendRuntimeEvent, createRuntimeEvent } from "../../../../lib/jarvis-runtime";

export const runtime = "nodejs";

/**
 * Durable sync for the Observer's local trade journal (Observer >= 1.0).
 * Idempotent: events are keyed by their client id, so the Observer can retry
 * a batch after any network failure without creating duplicates.
 */
export async function POST(request: Request) {
  const deviceId = request.headers.get("x-jarvis-device-id");
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const device = await authenticateObserverDevice(deviceId, token);
  if (!device) return Response.json({ ok: false, error: "Observer device is not paired." }, { status: 401 });

  const body = await request.json().catch(() => null) as { events?: unknown[] } | null;
  const events = (Array.isArray(body?.events) ? body!.events : []).slice(0, 200).map(normalizeJournalEvent).filter((event) => event !== null);
  if (!events.length) return Response.json({ ok: false, error: "No valid events." }, { status: 400 });

  const ctx = await durableContext();
  if (!ctx) {
    // Keep them on the PC: a non-2xx makes the Observer retry later instead of dropping data.
    return Response.json({ ok: false, error: "Durable storage is not configured on the server." }, { status: 503 });
  }

  const { error: eventError } = await ctx.db.from("trading_trade_events").upsert(events.map((event) => ({
    workspace_id: ctx.workspaceId,
    client_event_id: event.id,
    trade_id: event.tradeId,
    type: event.type,
    at: event.at,
    symbol: event.symbol,
    side: event.side,
    quantity: event.quantity,
    price: event.price,
    stop_price: event.stopPrice,
    target_price: event.targetPrice,
    open_pnl: event.pnl,
    payload: { ...event.payload, currentPrice: event.currentPrice, source: "observer-journal", deviceId: device.deviceId },
  })), { onConflict: "client_event_id", ignoreDuplicates: true });
  if (eventError) {
    return Response.json({ ok: false, error: "Could not store events: " + eventError.message }, { status: 502 });
  }

  const rules = await getTradingRules();
  const patches = journalEventsToTradePatches(events, rules.pointValues);
  for (const patch of patches) {
    const complete = typeof patch.opened_at === "string" && typeof patch.symbol === "string" && typeof patch.side === "string";
    const row = { ...patch, workspace_id: ctx.workspaceId, source: "observer-journal", updated_at: new Date().toISOString() };
    const { error } = complete
      ? await ctx.db.from("trading_trades").upsert({ status: "OPEN", quantity: 0, ...row }, { onConflict: "id" })
      : await ctx.db.from("trading_trades").update(row).eq("id", patch.id).eq("workspace_id", ctx.workspaceId);
    if (error) return Response.json({ ok: false, error: "Could not store trade: " + error.message }, { status: 502 });
  }

  for (const event of events.filter((item) => item.type === "EXIT")) {
    const pnl = typeof event.payload?.realizedPnl === "number" ? event.payload.realizedPnl as number : null;
    await appendRuntimeEvent(createRuntimeEvent({
      type: "trading.journal_trade_closed",
      domain: "TRADING",
      source: "jarvis.trading.observer-journal",
      importance: "NORMAL",
      summary: `${event.symbol ?? "Trade"} ${event.side ?? ""} closed and journaled${pnl == null ? "" : ` · ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`}.`,
    }));
  }

  return Response.json({ ok: true, accepted: events.map((event) => event.id), trades: patches.length });
}
