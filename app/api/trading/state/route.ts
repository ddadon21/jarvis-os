import { getTradingState } from "../../../../lib/trading-runtime";

export const runtime = "nodejs";

export async function GET() {
  const state = await getTradingState();
  return Response.json({
    state,
    observing: state.account.connection === "OBSERVING" || state.account.connection === "DEGRADED",
  });
}
