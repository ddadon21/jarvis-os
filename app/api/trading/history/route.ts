import { listStoredTrades } from "../../../../lib/trading-store";
import { getTradingState } from "../../../../lib/trading-runtime";

export const runtime = "nodejs";

/** Full observed trade history from durable storage (falls back to the runtime's last 100). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const since = url.searchParams.get("since") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? 500);
  const stored = await listStoredTrades({ since, limit: Number.isFinite(limit) ? limit : 500 });
  if (stored) {
    const closed = stored.filter((trade) => trade.status === "CLOSED");
    const withPnl = closed.filter((trade) => trade.realized_pnl != null);
    const wins = withPnl.filter((trade) => Number(trade.realized_pnl) > 0).length;
    return Response.json({
      ok: true,
      source: "durable",
      trades: stored,
      summary: {
        total: stored.length,
        closed: closed.length,
        withPnl: withPnl.length,
        estimatedPnl: closed.filter((trade) => trade.pnl_source === "ESTIMATED").length,
        winRate: withPnl.length ? Math.round((wins / withPnl.length) * 1000) / 10 : null,
        netPnl: Math.round(withPnl.reduce((sum, trade) => sum + Number(trade.realized_pnl), 0) * 100) / 100,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  }
  const state = await getTradingState();
  return Response.json({
    ok: true,
    source: "runtime-cache",
    warning: "Durable storage is not configured; showing only the runtime's most recent trades.",
    trades: [...state.openTrades, ...state.recentTrades],
  }, { headers: { "Cache-Control": "no-store" } });
}
