import { parseMarketWebhook } from "../../../../lib/learning/csv.ts";
import { insertSignals, upsertBars } from "../../../../lib/learning/store.ts";
import { priceFamily } from "../../../../lib/trading-symbols";

export const runtime = "nodejs";

/**
 * TradingView alert webhook (no broker API needed).
 * - kind "bar": one closed 1-minute bar from trading/indicators/jarvis-bar-feed.pine
 * - kind "signal": a shadow arrow from a generated DEVIANT candidate
 * TradingView cannot send headers, so the shared secret travels in the JSON body.
 */
export async function POST(request: Request) {
  const secret = process.env.JARVIS_MARKET_WEBHOOK_SECRET;
  if (!secret || secret.length < 16) {
    return Response.json({ ok: false, error: "Set JARVIS_MARKET_WEBHOOK_SECRET (16+ characters) in Vercel." }, { status: 503 });
  }
  const text = await request.text();
  let payload: Record<string, unknown> | null = null;
  try { payload = JSON.parse(text); } catch { /* handled below */ }
  if (!payload || payload.secret !== secret) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const parsed = parseMarketWebhook(payload);
  if (!parsed) return Response.json({ ok: false, error: "Invalid payload." }, { status: 400 });
  const family = priceFamily(parsed.symbol);
  if (!family) return Response.json({ ok: false, error: "Unknown symbol." }, { status: 400 });

  try {
    if (parsed.kind === "bar") {
      if (parsed.timeframe !== "1") return Response.json({ ok: false, error: "Only 1-minute bars are stored." }, { status: 400 });
      await upsertBars(family, "1", [parsed.bar], "tradingview-webhook");
      return Response.json({ ok: true, stored: "bar", family });
    }
    await insertSignals([{
      id: `${parsed.model}:${parsed.t}:${parsed.side}`,
      model: parsed.model,
      symbol: family,
      side: parsed.side,
      ts: new Date(parsed.t + 60_000).toISOString(),
      price: parsed.price,
      source: "tradingview-alert",
    }]);
    return Response.json({ ok: true, stored: "signal", family });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Store failed." }, { status: 502 });
  }
}
