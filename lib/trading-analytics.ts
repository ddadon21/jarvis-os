/**
 * Pure statistics over journaled trades (rows of trading_trades).
 * Used by the Trading agent and the learning reports. R = points / initial stop distance.
 */

export type AnalyticsTrade = {
  side: "LONG" | "SHORT";
  status: "OPEN" | "CLOSED";
  entry_price: number | null;
  exit_price: number | null;
  initial_stop: number | null;
  initial_target: number | null;
  opened_at: string;
  closed_at: string | null;
  prepared_at: string | null;
  realized_pnl: number | null;
  mfe_price: number | null;
  mae_price: number | null;
  session_day: string;
};

export type TradeStats = {
  trades: number;
  closed: number;
  sessions: number;
  tradesPerSession: number;
  winRate: number | null;
  netPnl: number;
  avgR: number | null;
  medianR: number | null;
  avgMfeR: number | null;
  avgMaeR: number | null;
  /** Share of closed trades that reached +1R at some point but finished below +0.5R. */
  gaveBackRate: number | null;
  avgPrepSeconds: number | null;
  avgHoldMinutes: number | null;
  bySide: Record<"LONG" | "SHORT", { trades: number; winRate: number | null; avgR: number | null }>;
  byHour: Array<{ hour: number; trades: number; winRate: number | null; avgR: number | null }>;
};

const NY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" });

function points(t: AnalyticsTrade, price: number | null) {
  if (t.entry_price == null || price == null) return null;
  return t.side === "LONG" ? price - t.entry_price : t.entry_price - price;
}

function rOf(t: AnalyticsTrade, price: number | null) {
  const pts = points(t, price);
  if (pts == null || t.initial_stop == null || t.entry_price == null) return null;
  const risk = Math.abs(t.entry_price - t.initial_stop);
  return risk > 0 ? pts / risk : null;
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const round = (value: number | null, digits = 2) => (value == null ? null : Math.round(value * 10 ** digits) / 10 ** digits);

export function tradeStats(rows: AnalyticsTrade[]): TradeStats {
  const closed = rows.filter((t) => t.status === "CLOSED");
  const withPnl = closed.filter((t) => t.realized_pnl != null);
  const rs = closed.map((t) => rOf(t, t.exit_price)).filter((r): r is number => r != null);
  const sortedR = [...rs].sort((a, b) => a - b);
  const mfeR = closed.map((t) => rOf(t, t.mfe_price)).filter((r): r is number => r != null);
  const maeR = closed.map((t) => rOf(t, t.mae_price)).filter((r): r is number => r != null);
  const gaveBack = closed.filter((t) => {
    const best = rOf(t, t.mfe_price);
    const final = rOf(t, t.exit_price);
    return best != null && final != null && best >= 1 && final < 0.5;
  }).length;
  const reachedOne = closed.filter((t) => (rOf(t, t.mfe_price) ?? 0) >= 1).length;
  const prep = rows.map((t) => (t.prepared_at ? (Date.parse(t.opened_at) - Date.parse(t.prepared_at)) / 1000 : null)).filter((s): s is number => s != null && s >= 0 && s < 3600);
  const hold = closed.map((t) => (t.closed_at ? (Date.parse(t.closed_at) - Date.parse(t.opened_at)) / 60000 : null)).filter((m): m is number => m != null && m >= 0);
  const sessions = new Set(rows.map((t) => t.session_day)).size;

  const sideStats = (side: "LONG" | "SHORT") => {
    const set = closed.filter((t) => t.side === side);
    const pnl = set.filter((t) => t.realized_pnl != null);
    const r = set.map((t) => rOf(t, t.exit_price)).filter((v): v is number => v != null);
    return { trades: rows.filter((t) => t.side === side).length, winRate: pnl.length ? round(pnl.filter((t) => Number(t.realized_pnl) > 0).length / pnl.length, 3) : null, avgR: round(mean(r)) };
  };

  const hours = new Map<number, AnalyticsTrade[]>();
  for (const t of rows) {
    const hour = Number(NY.format(new Date(t.opened_at)));
    hours.set(hour, [...(hours.get(hour) ?? []), t]);
  }

  return {
    trades: rows.length,
    closed: closed.length,
    sessions,
    tradesPerSession: sessions ? round(rows.length / sessions)! : 0,
    winRate: withPnl.length ? round(withPnl.filter((t) => Number(t.realized_pnl) > 0).length / withPnl.length, 3) : null,
    netPnl: round(withPnl.reduce((sum, t) => sum + Number(t.realized_pnl), 0))!,
    avgR: round(mean(rs)),
    medianR: sortedR.length ? round(sortedR[Math.floor(sortedR.length / 2)]) : null,
    avgMfeR: round(mean(mfeR)),
    avgMaeR: round(mean(maeR)),
    gaveBackRate: reachedOne ? round(gaveBack / reachedOne, 3) : null,
    avgPrepSeconds: round(mean(prep), 0),
    avgHoldMinutes: round(mean(hold), 1),
    bySide: { LONG: sideStats("LONG"), SHORT: sideStats("SHORT") },
    byHour: [...hours.entries()].sort((a, b) => a[0] - b[0]).map(([hour, set]) => {
      const done = set.filter((t) => t.status === "CLOSED");
      const pnl = done.filter((t) => t.realized_pnl != null);
      const r = done.map((t) => rOf(t, t.exit_price)).filter((v): v is number => v != null);
      return { hour, trades: set.length, winRate: pnl.length ? round(pnl.filter((t) => Number(t.realized_pnl) > 0).length / pnl.length, 3) : null, avgR: round(mean(r)) };
    }),
  };
}
