/**
 * CME futures session helpers.
 *
 * The CME Globex trading day for equity-index futures opens at 18:00 New York
 * time and belongs to the NEXT calendar date. Counting trades by UTC midnight
 * splits a single New York evening across two "days".
 */

const NY_TZ = "America/New_York";
const SESSION_ROLL_HOUR = 18;

function nyParts(at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute") };
}

/** Returns the CME session date (YYYY-MM-DD) a timestamp belongs to. */
export function sessionDay(value: string | number | Date): string {
  const at = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(at.getTime())) return new Date().toISOString().slice(0, 10);
  const { year, month, day, hour } = nyParts(at);
  const base = Date.UTC(year, month - 1, day);
  const shifted = hour >= SESSION_ROLL_HOUR ? base + 86_400_000 : base;
  let date = new Date(shifted);
  // Saturday/Sunday evenings roll into Monday's session.
  const weekday = date.getUTCDay();
  if (weekday === 6) date = new Date(shifted + 2 * 86_400_000);
  if (weekday === 0) date = new Date(shifted + 86_400_000);
  return date.toISOString().slice(0, 10);
}

/** Minutes since midnight in New York, for session-of-day features. */
export function nyMinuteOfDay(value: string | number | Date): number {
  const at = value instanceof Date ? value : new Date(value);
  const { hour, minute } = nyParts(at);
  return hour * 60 + minute;
}

/** Dollar value of a one-point move for one contract. */
const POINT_VALUES: Array<[RegExp, number]> = [
  [/^MNQ/, 2],
  [/^NQ/, 20],
  [/^MES/, 5],
  [/^ES/, 50],
  [/^MYM/, 0.5],
  [/^YM/, 5],
  [/^M2K/, 5],
  [/^RTY/, 50],
  [/^MCL/, 100],
  [/^CL/, 1000],
  [/^MGC/, 10],
  [/^GC/, 100],
];

export function pointValue(symbol: string | null | undefined, overrides?: Record<string, number>): number | null {
  if (!symbol) return null;
  const root = symbol.toUpperCase().replace(/^[A-Z0-9_]+:/, "").replace(/[^A-Z0-9]/g, "");
  if (overrides) {
    for (const [prefix, value] of Object.entries(overrides)) {
      if (root.startsWith(prefix.toUpperCase()) && Number.isFinite(value)) return value;
    }
  }
  for (const [pattern, value] of POINT_VALUES) {
    if (pattern.test(root)) return value;
  }
  return null;
}

export function estimatePnl(input: {
  symbol: string | null;
  side: "LONG" | "SHORT" | null;
  quantity: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
}, overrides?: Record<string, number>): number | null {
  const pv = pointValue(input.symbol, overrides);
  if (pv == null || !input.side || !input.quantity || input.entryPrice == null || input.exitPrice == null) return null;
  const points = input.side === "LONG" ? input.exitPrice - input.entryPrice : input.entryPrice - input.exitPrice;
  const pnl = points * pv * input.quantity;
  return Number.isFinite(pnl) ? Math.round(pnl * 100) / 100 : null;
}
