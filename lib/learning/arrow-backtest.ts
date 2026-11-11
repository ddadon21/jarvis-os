import { atr, cci, deviantHma, ema, highest, lowest } from "./indicators.ts";
import { nyLocal, sessionKey } from "./features.ts";
import type { Bar, Side } from "./types.ts";

/**
 * DEVIANT arrow backtester.
 *
 * Runs the DEVIANT - REFINED indicator (trading/indicators/deviant-refined-baseline-v1.pine)
 * on the chart timeframe Dwight actually trades (30m / 2h / 3h / 4h on NQ and YM) and scores
 * every arrow by his rule: an arrow printed during the New York session is a WIN when price
 * reaches the opposite bank level ("opposite zone") before the stop, within that session.
 *
 * Every Pine input is a parameter so the Trading Observer can test versioned changes against
 * the baseline on identical bars. The baseline values are DEVIANT_V1 and are never mutated.
 */

export type DeviantParams = {
  cciLength: number;
  cciSmooth: number;
  cciThreshold: number;
  hmaPeriod: number;
  hmaSpeed: number;
  hmaLookback: number;
  atrPeriod: number;
  atrMult: number;
  minCandleBody: number;
  maxArrowsPerDay: number;
  sessionStart: number;
  sessionEnd: number;
  levelStep: number;
  wickZone: number;
};

export const DEVIANT_V1: Readonly<DeviantParams> = Object.freeze({
  cciLength: 14,
  cciSmooth: 10,
  cciThreshold: 30,
  hmaPeriod: 34,
  hmaSpeed: 1.5,
  hmaLookback: 10,
  atrPeriod: 14,
  atrMult: 0.8,
  minCandleBody: 10,
  maxArrowsPerDay: 3,
  sessionStart: 8,
  sessionEnd: 15,
  levelStep: 250,
  wickZone: 80,
});

export type ScoringRules = {
  /** Where the stop goes: the arrow candle's wick extreme, or the bank level beyond the wick zone. */
  stop: "ARROW_WICK" | "LEVEL_ZONE";
  /** How many bank levels away the "opposite zone" target is (1 = next level). */
  targetLevels: number;
  /** New York hour by which the move must happen (17 = CME daily close). */
  exitHourNy: number;
  /** A day counts as won when any of its first N arrows wins (Dwight: 1-2 arrows give the day's trade). */
  dayArrowsCounted: number;
};

export const DEFAULT_SCORING: Readonly<ScoringRules> = Object.freeze({
  stop: "ARROW_WICK",
  targetLevels: 1,
  exitHourNy: 17,
  dayArrowsCounted: 2,
});

export type Arrow = { index: number; t: number; closeT: number; side: Side; entry: number; high: number; low: number; levelBelow: number; levelAbove: number; day: string };

export type ArrowResult = "WIN" | "LOSS" | "OPEN" | "NO_TIME";

export type ScoredArrow = Arrow & {
  stop: number;
  target: number;
  riskPts: number;
  result: ArrowResult;
  r: number;
  mfeR: number;
  maeR: number;
  exitT: number | null;
  minutesToExit: number | null;
};

export type SideSummary = { arrows: number; wins: number; losses: number; open: number; winRate: number | null; avgR: number | null };

export type BacktestSummary = {
  arrows: number;
  wins: number;
  losses: number;
  open: number;
  noTime: number;
  /** wins / (wins + losses + open); arrows that printed after the exit hour are excluded. */
  winRate: number | null;
  avgR: number | null;
  totalR: number;
  avgRiskPts: number | null;
  avgMinutesToTarget: number | null;
  sessions: number;
  daysWithArrows: number;
  daysWon: number;
  /** Dwight's definition: share of arrow days where one of the first N arrows reached the opposite zone. */
  dayWinRate: number | null;
  arrowsPerArrowDay: number | null;
  long: SideSummary;
  short: SideSummary;
};

export type BacktestResult = {
  timeframeMinutes: number;
  chartBars: number;
  from: string | null;
  to: string | null;
  pathResolution: "1m" | "chart";
  params: DeviantParams;
  scoring: ScoringRules;
  summary: BacktestSummary;
  arrows: ScoredArrow[];
};

const MINUTE = 60_000;
const SESSION_OPEN_MINUTE = 18 * 60;

/** Minutes since the CME session open (18:00 New York). */
function sinceSessionOpen(t: number) {
  return (nyLocal(t).minute - SESSION_OPEN_MINUTE + 1440) % 1440;
}

/**
 * Builds chart bars from finer bars, aligned like TradingView futures charts: buckets start at the
 * 18:00 New York session open and the last bucket of a session is cut short at the daily close.
 * Each output bar's `t` is the bucket's open time.
 */
export function resampleBars(bars: Bar[], periodMinutes: number): Bar[] {
  const out: Bar[] = [];
  let lastKey = "";
  for (const bar of bars) {
    const since = sinceSessionOpen(bar.t);
    const bucket = Math.floor(since / periodMinutes);
    const key = sessionKey(bar.t) + ":" + bucket;
    if (key !== lastKey) {
      out.push({ t: bar.t - (since - bucket * periodMinutes) * MINUTE, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v });
      lastKey = key;
    } else {
      const k = out[out.length - 1];
      k.h = Math.max(k.h, bar.h);
      k.l = Math.min(k.l, bar.l);
      k.c = bar.c;
      k.v += bar.v;
    }
  }
  return out;
}

/** Close time of a chart bar: the next bucket start, cut at the 17:00 New York daily close. */
function barCloseTime(t: number, periodMinutes: number) {
  const since = sinceSessionOpen(t);
  return t + Math.min(periodMinutes, 23 * 60 - since) * MINUTE;
}

/** DEVIANT arrows, bar for bar as the Pine script fires them. */
export function deviantArrows(bars: Bar[], periodMinutes: number, params: DeviantParams = DEVIANT_V1): Arrow[] {
  const close = bars.map((b) => b.c);
  const high = bars.map((b) => b.h);
  const low = bars.map((b) => b.l);
  const hma = deviantHma(close, params.hmaPeriod, params.hmaSpeed);
  const hmaLow = lowest(hma, params.hmaLookback);
  const hmaHigh = highest(hma, params.hmaLookback);
  const cciEma = ema(cci(close, params.cciLength), params.cciSmooth);
  const atrSeries = atr(high, low, close, params.atrPeriod);

  const out: Arrow[] = [];
  let longCount = 0, shortCount = 0;
  let longFired = false, shortFired = false;
  let longBar = 0, shortBar = 0;
  let prevDay = "";

  for (let i = 0; i < bars.length; i += 1) {
    const b = bars[i];
    const day = sessionKey(b.t);
    if (i > 0 && day !== prevDay) { longCount = 0; shortCount = 0; }
    prevDay = day;

    const levelBelow = Math.floor(b.c / params.levelStep) * params.levelStep;
    const levelAbove = levelBelow + params.levelStep;
    const longRej = b.l <= levelBelow + params.wickZone && b.c > levelBelow;
    const shortRej = b.h >= levelAbove - params.wickZone && b.c < levelAbove;
    const atLow = !Number.isNaN(hma[i]) && hma[i] === hmaLow[i];
    const atHigh = !Number.isNaN(hma[i]) && hma[i] === hmaHigh[i];
    const cciBull = cciEma[i] > params.cciThreshold;
    const cciBear = cciEma[i] < -params.cciThreshold;
    const volOk = b.h - b.l > atrSeries[i] * params.atrMult;
    const body = Math.abs(b.c - b.o);
    const strongBull = b.c > b.o && body > params.minCandleBody;
    const strongBear = b.c < b.o && body > params.minCandleBody;
    const hour = Math.floor(nyLocal(b.t).minute / 60);
    const inSession = hour >= params.sessionStart && hour < params.sessionEnd;

    const longSetup = longRej && atLow && strongBull && (cciBull || volOk) && inSession && longCount < params.maxArrowsPerDay;
    const shortSetup = shortRej && atHigh && strongBear && (cciBear || volOk) && inSession && shortCount < params.maxArrowsPerDay;
    const longSignal = longSetup && !longFired;
    const shortSignal = shortSetup && !shortFired;

    const base = { index: i, t: b.t, closeT: barCloseTime(b.t, periodMinutes), entry: b.c, high: b.h, low: b.l, levelBelow, levelAbove, day };
    if (longSignal) { longCount += 1; longFired = true; longBar = i; out.push({ ...base, side: "LONG" }); }
    if (shortSignal) { shortCount += 1; shortFired = true; shortBar = i; out.push({ ...base, side: "SHORT" }); }
    if (i - longBar > 10) longFired = false;
    if (i - shortBar > 10) shortFired = false;
    if (!inSession) { longFired = false; shortFired = false; }
  }
  return out;
}

/** New York exit time for an arrow: `exitHourNy` on the arrow's CME session day. */
function exitTime(arrow: Arrow, exitHourNy: number) {
  const sessionOpenT = arrow.t - sinceSessionOpen(arrow.t) * MINUTE;
  const exitSince = (exitHourNy * 60 - SESSION_OPEN_MINUTE + 1440) % 1440 || 1440;
  return sessionOpenT + exitSince * MINUTE;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * Walks price after the arrow candle closes. A stop and target touched inside the same path bar
 * count as a LOSS (conservative). `path` should be 1-minute bars when available.
 */
export function scoreArrow(arrow: Arrow, path: Bar[], params: DeviantParams, rules: ScoringRules): ScoredArrow {
  const long = arrow.side === "LONG";
  const step = params.levelStep * Math.max(1, rules.targetLevels);
  const target = long ? arrow.levelBelow + step : arrow.levelAbove - step;
  const stop = rules.stop === "ARROW_WICK"
    ? (long ? arrow.low : arrow.high)
    : (long ? arrow.levelBelow - params.wickZone : arrow.levelAbove + params.wickZone);
  const risk = long ? arrow.entry - stop : stop - arrow.entry;
  const reward = long ? target - arrow.entry : arrow.entry - target;
  const end = exitTime(arrow, rules.exitHourNy);
  const base = { ...arrow, stop, target, riskPts: round(risk) };

  if (risk <= 0 || arrow.closeT >= end) {
    return { ...base, result: "NO_TIME", r: 0, mfeR: 0, maeR: 0, exitT: null, minutesToExit: null };
  }
  let mfe = 0, mae = 0, last = arrow.entry;
  for (const bar of path) {
    if (bar.t < arrow.closeT) continue;
    if (bar.t >= end) break;
    const favorable = long ? bar.h - arrow.entry : arrow.entry - bar.l;
    const adverse = long ? arrow.entry - bar.l : bar.h - arrow.entry;
    mfe = Math.max(mfe, favorable);
    mae = Math.max(mae, adverse);
    last = bar.c;
    const stopHit = long ? bar.l <= stop : bar.h >= stop;
    const targetHit = long ? bar.h >= target : bar.l <= target;
    if (stopHit || targetHit) {
      const win = targetHit && !stopHit;
      return {
        ...base,
        result: win ? "WIN" : "LOSS",
        r: win ? round(reward / risk) : -1,
        mfeR: round(mfe / risk), maeR: round(mae / risk),
        exitT: bar.t, minutesToExit: Math.round((bar.t - arrow.closeT) / MINUTE),
      };
    }
  }
  const openR = (long ? last - arrow.entry : arrow.entry - last) / risk;
  return { ...base, result: "OPEN", r: round(openR), mfeR: round(mfe / risk), maeR: round(mae / risk), exitT: null, minutesToExit: null };
}

function sideSummary(arrows: ScoredArrow[]): SideSummary {
  const decided = arrows.filter((a) => a.result !== "NO_TIME");
  const wins = decided.filter((a) => a.result === "WIN").length;
  return {
    arrows: arrows.length,
    wins,
    losses: decided.filter((a) => a.result === "LOSS").length,
    open: decided.filter((a) => a.result === "OPEN").length,
    winRate: decided.length ? round(wins / decided.length * 100, 1) : null,
    avgR: decided.length ? round(decided.reduce((s, a) => s + a.r, 0) / decided.length) : null,
  };
}

export function summarize(arrows: ScoredArrow[], sessions: number, rules: ScoringRules): BacktestSummary {
  const all = sideSummary(arrows);
  const decided = arrows.filter((a) => a.result !== "NO_TIME");
  const wins = decided.filter((a) => a.result === "WIN");
  const byDay = new Map<string, ScoredArrow[]>();
  for (const a of arrows) byDay.set(a.day, [...(byDay.get(a.day) ?? []), a]);
  let daysWon = 0;
  for (const dayArrows of byDay.values()) {
    const counted = [...dayArrows].sort((a, b) => a.t - b.t).slice(0, Math.max(1, rules.dayArrowsCounted));
    if (counted.some((a) => a.result === "WIN")) daysWon += 1;
  }
  return {
    arrows: arrows.length,
    wins: all.wins,
    losses: all.losses,
    open: all.open,
    noTime: arrows.length - decided.length,
    winRate: all.winRate,
    avgR: all.avgR,
    totalR: round(decided.reduce((s, a) => s + a.r, 0)),
    avgRiskPts: decided.length ? round(decided.reduce((s, a) => s + a.riskPts, 0) / decided.length) : null,
    avgMinutesToTarget: wins.length ? Math.round(wins.reduce((s, a) => s + (a.minutesToExit ?? 0), 0) / wins.length) : null,
    sessions,
    daysWithArrows: byDay.size,
    daysWon,
    dayWinRate: byDay.size ? round(daysWon / byDay.size * 100, 1) : null,
    arrowsPerArrowDay: byDay.size ? round(arrows.length / byDay.size) : null,
    long: sideSummary(arrows.filter((a) => a.side === "LONG")),
    short: sideSummary(arrows.filter((a) => a.side === "SHORT")),
  };
}

/** Finds the first index whose bar time is >= t (bars sorted ascending). */
function lowerBound(bars: Bar[], t: number) {
  let lo = 0, hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t < t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * Full backtest. Pass `chartBars` at the traded timeframe (native TradingView export) and/or
 * `minuteBars` (1-minute history). Without chart bars they are built from the minute bars.
 * Arrow outcomes are walked on 1-minute bars where they cover the arrow, else on chart bars.
 */
export function backtestArrows(input: {
  timeframeMinutes: number;
  chartBars?: Bar[];
  minuteBars?: Bar[];
  params?: Partial<DeviantParams>;
  scoring?: Partial<ScoringRules>;
}): BacktestResult {
  const params: DeviantParams = { ...DEVIANT_V1, ...input.params };
  const scoring: ScoringRules = { ...DEFAULT_SCORING, ...input.scoring };
  const minuteBars = input.minuteBars ?? [];
  const chartBars = input.chartBars?.length ? input.chartBars : resampleBars(minuteBars, input.timeframeMinutes);
  const arrows = deviantArrows(chartBars, input.timeframeMinutes, params);
  let usedMinute = false;
  const scored = arrows.map((arrow) => {
    const end = exitTime(arrow, scoring.exitHourNy);
    const start = lowerBound(minuteBars, arrow.closeT);
    const covered = start < minuteBars.length && minuteBars[start].t - arrow.closeT < 60 * MINUTE && minuteBars[start].t < end;
    if (covered) {
      usedMinute = true;
      return scoreArrow(arrow, minuteBars.slice(start, lowerBound(minuteBars, end)), params, scoring);
    }
    return scoreArrow(arrow, chartBars.slice(arrow.index + 1, lowerBound(chartBars, end)), params, scoring);
  });
  const sessions = new Set(chartBars.map((b) => sessionKey(b.t))).size;
  return {
    timeframeMinutes: input.timeframeMinutes,
    chartBars: chartBars.length,
    from: chartBars[0] ? new Date(chartBars[0].t).toISOString() : null,
    to: chartBars.length ? new Date(chartBars[chartBars.length - 1].t).toISOString() : null,
    pathResolution: usedMinute ? "1m" : "chart",
    params,
    scoring,
    summary: summarize(scored, sessions, scoring),
    arrows: scored,
  };
}
