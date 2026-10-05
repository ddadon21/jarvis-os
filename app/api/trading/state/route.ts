import { getTradingState } from "../../../../lib/trading-runtime";
import { countStoredTrades } from "../../../../lib/trading-store";

export const runtime = "nodejs";

export async function GET() {
  const [state, durableTradeCount] = await Promise.all([getTradingState(), countStoredTrades()]);
  return Response.json({
    state,
    durableTradeCount,
    observing: state.account.connection === "OBSERVING" || state.account.connection === "DEGRADED",
  }, { headers: { "Cache-Control": "no-store" } });
}
