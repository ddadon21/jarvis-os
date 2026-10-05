import { getTradingRules, saveTradingRules } from "../../../../lib/trading-rules";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ ok: true, rules: await getTradingRules() });
}

/** Owner-only (enforced by middleware): update prop firm, daily trade cap, risk target, point values. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ ok: false, error: "Rules object required." }, { status: 400 });
  return Response.json({ ok: true, rules: await saveTradingRules(body) });
}
