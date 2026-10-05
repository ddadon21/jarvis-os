import { barCoverage, listModelRuns, loadLabeledTrades } from "../../../../lib/learning/store.ts";
import { durableConfigured } from "../../../../lib/jarvis-db";
import { priceFamily } from "../../../../lib/trading-symbols";

export const runtime = "nodejs";

export async function GET() {
  if (!durableConfigured()) {
    return Response.json({ ok: false, configured: false, error: "Durable storage is not configured (SUPABASE_SERVICE_ROLE_KEY)." });
  }
  const [coverage, trades, runs] = await Promise.all([barCoverage(), loadLabeledTrades(), listModelRuns(12)]);
  const byFamily: Record<string, number> = {};
  for (const trade of trades) {
    const family = priceFamily(trade.symbol) ?? "OTHER";
    byFamily[family] = (byFamily[family] ?? 0) + 1;
  }
  return Response.json({
    ok: true,
    configured: true,
    webhookConfigured: Boolean(process.env.JARVIS_MARKET_WEBHOOK_SECRET && process.env.JARVIS_MARKET_WEBHOOK_SECRET.length >= 16),
    coverage: coverage ?? [],
    trades: { total: trades.length, byFamily, withPrepTime: trades.filter((t) => t.preparedAt).length, withInitialStop: trades.filter((t) => t.initialStop != null).length },
    runs: runs.map((run) => ({
      id: run.id,
      createdAt: run.createdAt,
      status: run.status,
      family: run.family,
      outcome: run.report.status,
      message: run.report.message,
      verdict: run.report.verdict,
      data: run.report.data ? { entries: run.report.data.entries, sessions: run.report.data.sessions, risk: run.report.data.risk, window: run.report.data.window } : null,
      rules: run.report.rules,
      metrics: run.report.metrics,
      hasPine: Boolean(run.report.pine),
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}
