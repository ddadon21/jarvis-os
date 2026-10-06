import { getTradingState } from "../../../../lib/trading-runtime";
import { countStoredTrades } from "../../../../lib/trading-store";
import { observerPhase } from "../../../../lib/trading-phase";
import { latestObserverDiagnostics } from "../../../../lib/observer-diagnostics";

export const runtime = "nodejs";

export async function GET() {
  const [state, durableTradeCount, observerDiagnostics] = await Promise.all([getTradingState(), countStoredTrades(), latestObserverDiagnostics()]);
  const now = Date.now();
  return Response.json({
    state: {
      ...state,
      // One of exactly five phases, computed at read time so ORDER_FILLED expires on schedule.
      observer: state.observer ? { ...state.observer, phase: observerPhase(state.observer, now) } : state.observer,
    },
    durableTradeCount,
    observerDiagnostics,
    observing: state.account.connection === "OBSERVING" || state.account.connection === "DEGRADED",
  }, { headers: { "Cache-Control": "no-store" } });
}
