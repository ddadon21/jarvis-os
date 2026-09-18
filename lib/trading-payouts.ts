import { getCache } from "@vercel/functions";

export type TradingPayout = {
  id: string;
  firm: string;
  accountLabel: string | null;
  requestedAt: string | null;
  approvedAt: string;
  grossAmount: number | null;
  traderNetAmount: number;
  splitPercent: number | null;
  status: "APPROVED" | "PAID";
  source: string;
};

const KEY = "jarvis:trading:payouts:v1";
const TTL = 60 * 60 * 24 * 365;

async function readPayouts(): Promise<TradingPayout[]> {
  try {
    return (await getCache().get(KEY) as TradingPayout[] | null) ?? [];
  } catch {
    return [];
  }
}

export async function getTradingPayoutSummary(range: "30D" | "6M" | "ALL") {
  const all = (await readPayouts())
    .filter((payout) => payout.status === "APPROVED" || payout.status === "PAID")
    .sort((a, b) => Date.parse(b.approvedAt) - Date.parse(a.approvedAt));

  const now = Date.now();
  const cutoff = range === "30D"
    ? now - 30 * 24 * 60 * 60 * 1000
    : range === "6M"
      ? now - 183 * 24 * 60 * 60 * 1000
      : Number.NEGATIVE_INFINITY;

  const payouts = all.filter((payout) => Date.parse(payout.approvedAt) >= cutoff);
  const totalNet = payouts.reduce((sum, payout) => sum + payout.traderNetAmount, 0);
  const totalGross = payouts.reduce((sum, payout) => sum + (payout.grossAmount ?? 0), 0);

  return {
    range,
    connected: all.length > 0,
    source: all.length > 0 ? "JARVIS PAYOUT LEDGER" : "LUCID PAYOUT HISTORY PENDING",
    count: payouts.length,
    totalNet: Math.round(totalNet * 100) / 100,
    totalGross: Math.round(totalGross * 100) / 100,
    averageNet: payouts.length ? Math.round((totalNet / payouts.length) * 100) / 100 : null,
    latest: payouts[0] ?? null,
    payouts: payouts.slice(0, 50),
  };
}

export async function replaceTradingPayouts(payouts: TradingPayout[]) {
  await getCache().set(KEY, payouts, { ttl: TTL, tags: ["jarvis-trading", "jarvis-payouts"] });
}
