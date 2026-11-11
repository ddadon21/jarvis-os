import { parseTradingViewCsv } from "../../../../../lib/learning/csv.ts";
import { upsertBars } from "../../../../../lib/learning/store.ts";
import { priceFamily } from "../../../../../lib/trading-symbols";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Chart timeframes accepted from TradingView exports: 1m for learning, 30m/2h/3h/4h for arrow backtests. */
const SUPPORTED_TIMEFRAMES = [1, 30, 120, 180, 240];

/** Owner-only: import TradingView "Export chart data" CSV as market history. */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const family = priceFamily(url.searchParams.get("symbol"));
  if (!family) return Response.json({ ok: false, error: "symbol query parameter is required (e.g. NQ1! or MNQ)." }, { status: 400 });
  const text = await request.text();
  if (text.length > 25_000_000) return Response.json({ ok: false, error: "CSV too large; export fewer bars per file." }, { status: 413 });
  try {
    const { bars, skipped, timeframeMinutes } = parseTradingViewCsv(text);
    if (!timeframeMinutes || !SUPPORTED_TIMEFRAMES.includes(timeframeMinutes)) {
      return Response.json({ ok: false, error: `This CSV looks like a ${timeframeMinutes ?? "?"}-minute chart. Export from a 1m, 30m, 2h, 3h or 4h chart.` }, { status: 400 });
    }
    const written = await upsertBars(family, String(timeframeMinutes), bars, "tradingview-csv");
    return Response.json({
      ok: true, family, timeframeMinutes, written, skipped,
      from: bars[0] ? new Date(bars[0].t).toISOString() : null,
      to: bars.length ? new Date(bars[bars.length - 1].t).toISOString() : null,
    });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Import failed." }, { status: 400 });
  }
}
