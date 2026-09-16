import { ingestTradingObservation, type TradingObservationInput } from "../../../../lib/trading-runtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.JARVIS_TRADING_SECRET;
  if (!secret) {
    return Response.json({ ok: false, error: "Trading ingest is locked until JARVIS_TRADING_SECRET is configured." }, { status: 503 });
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as TradingObservationInput | null;
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "Invalid trading observation payload." }, { status: 400 });
  }

  if (Array.isArray(body.trades) && body.trades.length > 200) {
    return Response.json({ ok: false, error: "Too many trade events in one request." }, { status: 400 });
  }

  const state = await ingestTradingObservation(body);
  return Response.json({ ok: true, state });
}
