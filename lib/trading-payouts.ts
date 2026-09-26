import { getCache } from "@vercel/functions";

export type TradingPayout = {
  id: string;
  firm: string;
  accountLabel: string | null;
  requestedAt: string | null;
  approvedAt: string | null;
  grossAmount: number | null;
  traderNetAmount: number;
  splitPercent: number | null;
  status: "APPROVED" | "PAID";
  source: string;
};

const KEY = "jarvis:trading:payouts:v1";
const TTL = 60 * 60 * 24 * 365;

const MANUAL_PAYOUTS: TradingPayout[] = [
  {
    id: "manual-lucid-2026-09-07-901",
    firm: "Lucid Trading",
    accountLabel: null,
    requestedAt: null,
    approvedAt: "2026-09-07T12:00:00-05:00",
    grossAmount: 901,
    traderNetAmount: 810,
    splitPercent: 90,
    status: "PAID",
    source: "DWIGHT MANUAL RECORD",
  },
  {
    id: "manual-topstep-525",
    firm: "Topstep",
    accountLabel: null,
    requestedAt: null,
    approvedAt: null,
    grossAmount: 525,
    traderNetAmount: 525,
    splitPercent: null,
    status: "PAID",
    source: "DWIGHT MANUAL RECORD",
  },
]

const LIFETIME_PAYOUT_COUNT_FLOOR = 4;

async function readPayouts(): Promise<TradingPayout[]> {
  try {
    return (await getCache().get(KEY) as TradingPayout[] | null) ?? [];
  } catch {
    return [];
  }
}

export async function getTradingPayoutSummary(range: "30D" | "6M" | "ALL") {
  const stored = (await readPayouts())
    .filter((payout) => payout.status === "APPROVED" || payout.status === "PAID");

  const merged = new Map<string, TradingPayout>();
  for (const payout of [...MANUAL_PAYOUTS, ...stored]) {
    const identity = payout.id || `${payout.firm}:${payout.approvedAt}:${payout.traderNetAmount}`;
    merged.set(identity, payout);
  }

  const all = [...merged.values()]
    .sort((a, b) => {
      const aTime = a.approvedAt ? Date.parse(a.approvedAt) : Number.NEGATIVE_INFINITY;
      const bTime = b.approvedAt ? Date.parse(b.approvedAt) : Number.NEGATIVE_INFINITY;
      return bTime - aTime;
    });

  const now = Date.now();
  const cutoff = range === "30D"
    ? now - 30 * 24 * 60 * 60 * 1000
    : range === "6M"
      ? now - 183 * 24 * 60 * 60 * 1000
      : Number.NEGATIVE_INFINITY;

  const payouts = all.filter((payout) => {
    if (range === "ALL") return true;
    if (!payout.approvedAt) return false;
    return Date.parse(payout.approvedAt) >= cutoff;
  });
  const totalNet = payouts.reduce((sum, payout) => sum + payout.traderNetAmount, 0);
  const totalGross = payouts.reduce((sum, payout) => sum + (payout.grossAmount ?? 0), 0);

  const lifetimeCount = Math.max(LIFETIME_PAYOUT_COUNT_FLOOR, all.length);

  return {
    range,
    connected: all.length > 0,
    source: "JARVIS PAYOUT LEDGER",
    count: payouts.length,
    recordedCount: all.length,
    lifetimeCount,
    nextPayoutNumber: lifetimeCount + 1,
    unitemizedCount: Math.max(0, lifetimeCount - all.length),
    totalNet: Math.round(totalNet * 100) / 100,
    totalGross: Math.round(totalGross * 100) / 100,
    averageNet: payouts.length ? Math.round((totalNet / payouts.length) * 100) / 100 : null,
    latest: all.find((payout) => payout.approvedAt) ?? all[0] ?? null,
    payouts: payouts.slice(0, 50),
  };
}

export async function replaceTradingPayouts(payouts: TradingPayout[]) {
  await getCache().set(KEY, payouts, { ttl: TTL, tags: ["jarvis-trading", "jarvis-payouts"] });
}
