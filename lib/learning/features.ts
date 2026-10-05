import type { Bar } from "./types.ts";
import { atr, cci, confirmedPivots, deviantHma, ema, highest, lowest, sma } from "./indicators.ts";

/**
 * Feature engine over 1-minute bars.
 *
 * Every feature is defined twice: a TypeScript computation (for learning and
 * replay) and a Pine v6 snippet (for the generated indicator). Both use only
 * information available at the close of the current bar; higher-timeframe
 * values come from the last COMPLETED 60m / 240m / daily bar, matching Pine's
 * non-repainting `request.security(..., expr[1], lookahead_on)` pattern.
 *
 * Higher timeframes are aligned to the CME session that opens 18:00 New York.
 */

export type FeatureSpec = {
  name: string;
  label: string;
  /** Pine statements defining `f_<name>` (may reference shared blocks). */
  pine: string;
  /** Shared Pine blocks this feature needs. */
  needs: PineBlock[];
  /** True when the feature is a 0/1 flag. */
  flag?: boolean;
};

export type PineBlock = "core" | "hma" | "htf60" | "htf240" | "daily" | "session" | "bank";

export const PINE_BLOCKS: Record<PineBlock, string> = {
  core: `atr14 = ta.atr(14)
ema21 = ta.ema(close, 21)
ny_min = hour(time, "America/New_York") * 60 + minute(time, "America/New_York")`,
  hma: `f_hma_calc(src, length, speed) =>
    wma1 = ta.wma(src, int(length / 2))
    wma2 = ta.wma(src, length)
    ta.wma(2 * wma1 - wma2, int(math.sqrt(length) * speed))
hma = f_hma_calc(close, 34, 1.5)`,
  htf60: `[h60_trend, atr60] = request.security(syminfo.tickerid, "60", [((close - ta.ema(close, 50)) / ta.atr(14))[1], ta.atr(14)[1]], lookahead = barmerge.lookahead_on)`,
  htf240: `[h4_trend, h4_ph, h4_pl] = request.security(syminfo.tickerid, "240", [((close - ta.ema(close, 20)) / ta.atr(14))[1], fixnan(ta.pivothigh(high, 3, 3))[1], fixnan(ta.pivotlow(low, 3, 3))[1]], lookahead = barmerge.lookahead_on)`,
  daily: `[d_trend, d_ph, d_pl, pdh, pdl] = request.security(syminfo.tickerid, "D", [((close - open) / math.max(high - low, syminfo.mintick))[1], fixnan(ta.pivothigh(high, 2, 2))[1], fixnan(ta.pivotlow(low, 2, 2))[1], high[1], low[1]], lookahead = barmerge.lookahead_on)`,
  session: `new_session = ta.change(time("D")) != 0
var float sess_low = na
var float sess_high = na
sess_low := new_session ? low : math.min(nz(sess_low, low), low)
sess_high := new_session ? high : math.max(nz(sess_high, high), high)`,
  bank: `level_below = math.floor(close / 250) * 250
level_above = level_below + 250`,
};

export const FEATURES: FeatureSpec[] = [
  { name: "body_atr", label: "Candle body vs ATR", needs: ["core"], pine: "f_body_atr = math.abs(close - open) / atr14" },
  { name: "range_atr", label: "Candle range vs ATR", needs: ["core"], pine: "f_range_atr = (high - low) / atr14" },
  { name: "close_pos", label: "Close position in candle (0 low, 1 high)", needs: ["core"], pine: "f_close_pos = high == low ? 0.5 : (close - low) / (high - low)" },
  { name: "ema21_dist_atr", label: "Distance from EMA21 in ATR", needs: ["core"], pine: "f_ema21_dist_atr = (close - ema21) / atr14" },
  { name: "ema21_slope_atr", label: "EMA21 slope (5 bars) in ATR", needs: ["core"], pine: "f_ema21_slope_atr = (ema21 - ema21[5]) / atr14" },
  { name: "cci_smooth", label: "Smoothed CCI(14,10)", needs: [], pine: "f_cci_smooth = ta.ema(ta.cci(close, 14), 10)" },
  { name: "hma_slope_atr", label: "DEVIANT HMA slope in ATR", needs: ["core", "hma"], pine: "f_hma_slope_atr = (hma - hma[1]) / atr14" },
  { name: "hma_at_low", label: "HMA at 10-bar low", needs: ["hma"], flag: true, pine: "f_hma_at_low = hma == ta.lowest(hma, 10) ? 1 : 0" },
  { name: "hma_at_high", label: "HMA at 10-bar high", needs: ["hma"], flag: true, pine: "f_hma_at_high = hma == ta.highest(hma, 10) ? 1 : 0" },
  { name: "ny_minute", label: "New York minute of day", needs: ["core"], pine: "f_ny_minute = ny_min" },
  { name: "htf60_trend", label: "1H trend: close vs EMA50 in ATR", needs: ["htf60"], pine: "f_htf60_trend = h60_trend" },
  { name: "htf240_trend", label: "4H trend: close vs EMA20 in ATR", needs: ["htf240"], pine: "f_htf240_trend = h4_trend" },
  { name: "daily_trend", label: "Prior day body vs range", needs: ["daily"], pine: "f_daily_trend = d_trend" },
  { name: "dist_4h_high_atr", label: "Distance below last 4H pivot high (1H ATR)", needs: ["htf60", "htf240"], pine: "f_dist_4h_high_atr = (h4_ph - close) / atr60" },
  { name: "dist_4h_low_atr", label: "Distance above last 4H pivot low (1H ATR)", needs: ["htf60", "htf240"], pine: "f_dist_4h_low_atr = (close - h4_pl) / atr60" },
  { name: "dist_d_high_atr", label: "Distance below last daily pivot high (1H ATR)", needs: ["htf60", "daily"], pine: "f_dist_d_high_atr = (d_ph - close) / atr60" },
  { name: "dist_d_low_atr", label: "Distance above last daily pivot low (1H ATR)", needs: ["htf60", "daily"], pine: "f_dist_d_low_atr = (close - d_pl) / atr60" },
  { name: "swept_low_bars", label: "Bars since a 60-bar low was swept and reclaimed", needs: [], pine: `lo60 = ta.lowest(low, 60)[1]
f_swept_low_bars = math.min(60, nz(ta.barssince(low < lo60 and close > lo60), 60))` },
  { name: "swept_high_bars", label: "Bars since a 60-bar high was swept and rejected", needs: [], pine: `hi60 = ta.highest(high, 60)[1]
f_swept_high_bars = math.min(60, nz(ta.barssince(high > hi60 and close < hi60), 60))` },
  { name: "swept_pdl", label: "Prior-day low swept this session and reclaimed", needs: ["daily", "session"], flag: true, pine: "f_swept_pdl = sess_low < pdl and close > pdl ? 1 : 0" },
  { name: "swept_pdh", label: "Prior-day high swept this session and rejected", needs: ["daily", "session"], flag: true, pine: "f_swept_pdh = sess_high > pdh and close < pdh ? 1 : 0" },
  { name: "fvg_bull_bars", label: "Bars since a bullish fair value gap", needs: [], pine: "f_fvg_bull_bars = math.min(30, nz(ta.barssince(low > high[2]), 30))" },
  { name: "fvg_bear_bars", label: "Bars since a bearish fair value gap", needs: [], pine: "f_fvg_bear_bars = math.min(30, nz(ta.barssince(high < low[2]), 30))" },
  { name: "bank_long_rej", label: "DEVIANT bank-level wick rejection (long)", needs: ["bank"], flag: true, pine: "f_bank_long_rej = low <= level_below + 80 and close > level_below ? 1 : 0" },
  { name: "bank_short_rej", label: "DEVIANT bank-level wick rejection (short)", needs: ["bank"], flag: true, pine: "f_bank_short_rej = high >= level_above - 80 and close < level_above ? 1 : 0" },
  { name: "vol_rel", label: "Volume vs 20-bar average", needs: [], pine: "f_vol_rel = volume / math.max(ta.sma(volume, 20), 1)" },
  { name: "range_15_atr", label: "15-bar range in ATR (compression)", needs: ["core"], pine: "f_range_15_atr = (ta.highest(high, 15) - ta.lowest(low, 15)) / atr14" },
];

export type FeatureFrame = {
  t: number[];
  open: number[];
  close: number[];
  high: number[];
  low: number[];
  atr14: number[];
  nyMinute: number[];
  session: string[];
  columns: Record<string, number[]>;
};

/* ---------------- New York time (fast, cached per hour) ---------------- */

const offsetCache = new Map<number, number>();
const nyFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});

function nyOffsetMinutes(t: number) {
  const hourKey = Math.floor(t / 3_600_000);
  const cached = offsetCache.get(hourKey);
  if (cached !== undefined) return cached;
  const parts = nyFormatter.formatToParts(new Date(hourKey * 3_600_000));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  const offset = Math.round((asUtc - hourKey * 3_600_000) / 60_000);
  offsetCache.set(hourKey, offset);
  return offset;
}

export function nyLocal(t: number) {
  const local = t + nyOffsetMinutes(t) * 60_000;
  const d = new Date(local);
  return { minute: d.getUTCHours() * 60 + d.getUTCMinutes(), localMs: local };
}

/** CME session key (YYYY-MM-DD): bars from 18:00 New York belong to the next date. */
export function sessionKey(t: number) {
  const { localMs } = nyLocal(t);
  return new Date(localMs + 6 * 3_600_000).toISOString().slice(0, 10);
}

/* ---------------- Higher-timeframe resampling ---------------- */

type Htf = { o: number[]; h: number[]; l: number[]; c: number[]; index: number[] };

function resample(bars: Bar[], periodMinutes: number | "D", minute: number[], session: string[]): Htf {
  const o: number[] = [], h: number[] = [], l: number[] = [], c: number[] = [];
  const index = new Array<number>(bars.length);
  let lastKey = "";
  for (let i = 0; i < bars.length; i += 1) {
    const sinceOpen = (minute[i] - 1080 + 1440) % 1440;
    const key = periodMinutes === "D" ? session[i] : session[i] + ":" + Math.floor(sinceOpen / periodMinutes);
    if (key !== lastKey) {
      o.push(bars[i].o); h.push(bars[i].h); l.push(bars[i].l); c.push(bars[i].c);
      lastKey = key;
    } else {
      const k = h.length - 1;
      h[k] = Math.max(h[k], bars[i].h);
      l[k] = Math.min(l[k], bars[i].l);
      c[k] = bars[i].c;
    }
    index[i] = h.length - 1;
  }
  return { o, h, l, c, index };
}

/** Value of the last COMPLETED higher-timeframe bar for each 1m bar. */
function previousCompleted(series: number[], htf: Htf) {
  return htf.index.map((k) => (k >= 1 ? series[k - 1] : NaN));
}

function barsSince(flags: boolean[], cap: number) {
  const out = new Array<number>(flags.length);
  let last = -1;
  for (let i = 0; i < flags.length; i += 1) {
    if (flags[i]) last = i;
    out[i] = last < 0 ? cap : Math.min(cap, i - last);
  }
  return out;
}

const shift = (src: number[], n: number) => src.map((_, i) => (i - n >= 0 ? src[i - n] : NaN));

export function computeFeatures(bars: Bar[]): FeatureFrame {
  const t = bars.map((b) => b.t);
  const open = bars.map((b) => b.o);
  const high = bars.map((b) => b.h);
  const low = bars.map((b) => b.l);
  const close = bars.map((b) => b.c);
  const volume = bars.map((b) => b.v);
  const nyMinute = t.map((x) => nyLocal(x).minute);
  const session = t.map(sessionKey);

  const atr14 = atr(high, low, close, 14);
  const ema21 = ema(close, 21);
  const hma = deviantHma(close, 34, 1.5);
  const hmaLow = lowest(hma, 10);
  const hmaHigh = highest(hma, 10);

  const h60 = resample(bars, 60, nyMinute, session);
  const h60Trend = h60.c.map((_, k) => NaN);
  {
    const e = ema(h60.c, 50);
    const a = atr(h60.h, h60.l, h60.c, 14);
    for (let k = 0; k < h60.c.length; k += 1) h60Trend[k] = (h60.c[k] - e[k]) / a[k];
  }
  const atr60 = previousCompleted(atr(h60.h, h60.l, h60.c, 14), h60);

  const h4 = resample(bars, 240, nyMinute, session);
  const h4TrendRaw = (() => {
    const e = ema(h4.c, 20);
    const a = atr(h4.h, h4.l, h4.c, 14);
    return h4.c.map((c, k) => (c - e[k]) / a[k]);
  })();
  const h4Piv = confirmedPivots(h4.h, h4.l, 3, 3);

  const d = resample(bars, "D", nyMinute, session);
  const dTrendRaw = d.c.map((c, k) => (c - d.o[k]) / Math.max(d.h[k] - d.l[k], 1e-9));
  const dPiv = confirmedPivots(d.h, d.l, 2, 2);
  const pdh = previousCompleted(d.h, d);
  const pdl = previousCompleted(d.l, d);

  const lo60 = shift(lowest(low, 60), 1);
  const hi60 = shift(highest(high, 60), 1);
  const sweepLow = low.map((l, i) => l < lo60[i] && close[i] > lo60[i]);
  const sweepHigh = high.map((h, i) => h > hi60[i] && close[i] < hi60[i]);
  const bullFvg = low.map((l, i) => i >= 2 && l > high[i - 2]);
  const bearFvg = high.map((h, i) => i >= 2 && h < low[i - 2]);

  const sessLow: number[] = [];
  const sessHigh: number[] = [];
  for (let i = 0; i < bars.length; i += 1) {
    const fresh = i === 0 || session[i] !== session[i - 1];
    sessLow.push(fresh ? low[i] : Math.min(sessLow[i - 1], low[i]));
    sessHigh.push(fresh ? high[i] : Math.max(sessHigh[i - 1], high[i]));
  }

  const ema21Prev5 = shift(ema21, 5);
  const hmaPrev = shift(hma, 1);
  const cciSmooth = ema(cci(close, 14), 10);
  const volAvg = sma(volume, 20);
  const hi15 = highest(high, 15);
  const lo15 = lowest(low, 15);

  const h4ph = previousCompleted(h4Piv.lastHigh, h4);
  const h4pl = previousCompleted(h4Piv.lastLow, h4);
  const dph = previousCompleted(dPiv.lastHigh, d);
  const dpl = previousCompleted(dPiv.lastLow, d);

  const columns: Record<string, number[]> = {
    body_atr: close.map((c, i) => Math.abs(c - open[i]) / atr14[i]),
    range_atr: close.map((_, i) => (high[i] - low[i]) / atr14[i]),
    close_pos: close.map((c, i) => (high[i] === low[i] ? 0.5 : (c - low[i]) / (high[i] - low[i]))),
    ema21_dist_atr: close.map((c, i) => (c - ema21[i]) / atr14[i]),
    ema21_slope_atr: close.map((_, i) => (ema21[i] - ema21Prev5[i]) / atr14[i]),
    cci_smooth: cciSmooth,
    hma_slope_atr: close.map((_, i) => (hma[i] - hmaPrev[i]) / atr14[i]),
    hma_at_low: hma.map((v, i) => (v === hmaLow[i] ? 1 : 0)),
    hma_at_high: hma.map((v, i) => (v === hmaHigh[i] ? 1 : 0)),
    ny_minute: nyMinute,
    htf60_trend: previousCompleted(h60Trend, h60),
    htf240_trend: previousCompleted(h4TrendRaw, h4),
    daily_trend: previousCompleted(dTrendRaw, d),
    dist_4h_high_atr: close.map((c, i) => (h4ph[i] - c) / atr60[i]),
    dist_4h_low_atr: close.map((c, i) => (c - h4pl[i]) / atr60[i]),
    dist_d_high_atr: close.map((c, i) => (dph[i] - c) / atr60[i]),
    dist_d_low_atr: close.map((c, i) => (c - dpl[i]) / atr60[i]),
    swept_low_bars: barsSince(sweepLow, 60),
    swept_high_bars: barsSince(sweepHigh, 60),
    swept_pdl: close.map((c, i) => (sessLow[i] < pdl[i] && c > pdl[i] ? 1 : 0)),
    swept_pdh: close.map((c, i) => (sessHigh[i] > pdh[i] && c < pdh[i] ? 1 : 0)),
    fvg_bull_bars: barsSince(bullFvg, 30),
    fvg_bear_bars: barsSince(bearFvg, 30),
    bank_long_rej: close.map((c, i) => {
      const below = Math.floor(c / 250) * 250;
      return low[i] <= below + 80 && c > below ? 1 : 0;
    }),
    bank_short_rej: close.map((c, i) => {
      const above = Math.floor(c / 250) * 250 + 250;
      return high[i] >= above - 80 && c < above ? 1 : 0;
    }),
    vol_rel: volume.map((v, i) => v / Math.max(volAvg[i], 1)),
    range_15_atr: close.map((_, i) => (hi15[i] - lo15[i]) / atr14[i]),
  };

  for (const spec of FEATURES) {
    if (!columns[spec.name]) throw new Error("Feature not computed: " + spec.name);
  }
  return { t, open, close, high, low, atr14, nyMinute, session, columns };
}

/** Index of the last bar whose close (open + 60 s) is at or before `time`. */
export function decisionBarIndex(frame: FeatureFrame, time: number): number {
  let lo = 0;
  let hi = frame.t.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frame.t[mid] + 60_000 <= time) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}
