import { getTradingPayoutSummary } from "../../../../lib/trading-payouts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("range")?.toUpperCase();
  const range = raw === "30D" || raw === "6M" || raw === "ALL" ? raw : "ALL";
  const summary = await getTradingPayoutSummary(range);
  return Response.json({ ok: true, summary });
}
