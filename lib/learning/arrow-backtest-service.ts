import { appendRuntimeEvent, createRuntimeEvent } from "../jarvis-runtime";
import { durableContext } from "../jarvis-db";
import { priceFamily } from "../trading-symbols";
import { backtestArrows, DEFAULT_SCORING, DEVIANT_V1, type BacktestResult, type DeviantParams, type ScoringRules } from "./arrow-backtest.ts";
import { loadBars, timeframeCoverage } from "./store.ts";

/** Dwight trades the arrow on NQ/MNQ and YM/MYM, on these chart timeframes (minutes). */
export const TRADED_FAMILIES = ["NQ", "YM"] as const;
export const TRADED_TIMEFRAMES = [30, 120, 180, 240] as const;

const DAY = 86_400_000;

async function durableConfigured() {
  return Boolean(await durableContext().catch(() => null));
}
/** Extra history so the indicator's HMA/CCI/ATR are warmed up before the first scored day (50+ 4h bars). */
const WARMUP_DAYS = 14;

export type ArrowBacktestRun = {
  family: string;
  timeframeMinutes: number;
  source: "native" | "resampled-1m" | "none";
  result: BacktestResult | null;
  message: string | null;
};

/** Accepts only known numeric indicator inputs within sane bounds. */
export function sanitizeParams(input: unknown): Partial<DeviantParams> {
  if (!input || typeof input !== "object") return {};
  const out: Partial<DeviantParams> = {};
  for (const key of Object.keys(DEVIANT_V1) as (keyof DeviantParams)[]) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100_000) out[key] = value;
  }
  return out;
}

export function sanitizeScoring(input: unknown): Partial<ScoringRules> {
  if (!input || typeof input !== "object") return {};
  const raw = input as Record<string, unknown>;
  const out: Partial<ScoringRules> = {};
  if (raw.stop === "ARROW_WICK" || raw.stop === "LEVEL_ZONE") out.stop = raw.stop;
  if (typeof raw.targetLevels === "number" && raw.targetLevels >= 1 && raw.targetLevels <= 4) out.targetLevels = Math.round(raw.targetLevels);
  if (typeof raw.exitHourNy === "number" && raw.exitHourNy >= 9 && raw.exitHourNy <= 18) out.exitHourNy = Math.round(raw.exitHourNy);
  if (typeof raw.dayArrowsCounted === "number" && raw.dayArrowsCounted >= 1 && raw.dayArrowsCounted <= 5) out.dayArrowsCounted = Math.round(raw.dayArrowsCounted);
  return out;
}

/**
 * Backtests the arrow for each family × timeframe. Prefers native chart exports for the
 * timeframe (longest history, identical to TradingView); otherwise builds the chart bars from
 * stored 1-minute bars. Outcomes are walked on 1-minute bars wherever they exist.
 */
export async function runArrowBacktests(input: {
  families?: string[];
  timeframes?: number[];
  days?: number;
  params?: Partial<DeviantParams>;
  scoring?: Partial<ScoringRules>;
  label?: string;
  maxArrowsReturned?: number;
}): Promise<{ ok: boolean; error?: string; runs: ArrowBacktestRun[] }> {
  if (!(await durableConfigured())) return { ok: false, error: "Durable storage is not configured, so there are no stored bars to backtest.", runs: [] };
  const families = (input.families?.length ? input.families : [...TRADED_FAMILIES]).map((f) => priceFamily(f)).filter((f): f is string => Boolean(f));
  const timeframes = (input.timeframes?.length ? input.timeframes : [...TRADED_TIMEFRAMES]).filter((tf) => (TRADED_TIMEFRAMES as readonly number[]).includes(tf));
  const days = Math.max(5, Math.min(1460, Math.round(input.days ?? 365)));
  const now = Date.now();
  const from = now - (days + WARMUP_DAYS) * DAY;
  const runs: ArrowBacktestRun[] = [];

  for (const family of [...new Set(families)]) {
    const minuteBars = await loadBars(family, from, now, "1");
    for (const timeframeMinutes of timeframes) {
      const native = await loadBars(family, from, now, String(timeframeMinutes));
      if (!native.length && minuteBars.length < 1440) {
        runs.push({ family, timeframeMinutes, source: "none", result: null, message: `No ${family} ${label(timeframeMinutes)} history stored. Import a TradingView ${label(timeframeMinutes)} chart export.` });
        continue;
      }
      const result = backtestArrows({ timeframeMinutes, chartBars: native, minuteBars, params: input.params, scoring: input.scoring });
      const cap = input.maxArrowsReturned ?? 150;
      runs.push({
        family,
        timeframeMinutes,
        source: native.length ? "native" : "resampled-1m",
        result: { ...result, arrows: result.arrows.slice(-cap) },
        message: result.chartBars < 60 ? `Only ${result.chartBars} chart bars; results are thin until more history is imported.` : null,
      });
    }
  }

  const scored = runs.filter((run) => run.result);
  if (scored.length) {
    const line = scored.map((run) => {
      const s = run.result!.summary;
      return `${run.family} ${label(run.timeframeMinutes)}: ${s.arrows} arrows, ${s.winRate ?? "–"}% win, ${s.dayWinRate ?? "–"}% days`;
    }).join(" · ");
    await appendRuntimeEvent(createRuntimeEvent({
      type: "trading.arrow_backtest",
      domain: "TRADING",
      source: "jarvis.arrow-backtest",
      importance: "NORMAL",
      summary: `Arrow backtest (${input.label ?? "DEVIANT v1"}, ${days}d): ${line}`.slice(0, 600),
    })).catch(() => undefined);
  }
  return { ok: true, runs };
}

export async function arrowBacktestCoverage() {
  if (!(await durableConfigured())) return null;
  const rows = await Promise.all(TRADED_FAMILIES.map(async (family) => ({ family, timeframes: (await timeframeCoverage(family)) ?? [] })));
  return rows;
}

export function label(minutes: number) {
  return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}

export { DEFAULT_SCORING, DEVIANT_V1 };
