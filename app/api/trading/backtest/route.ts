import { arrowBacktestCoverage, DEFAULT_SCORING, DEVIANT_V1, runArrowBacktests, sanitizeParams, sanitizeScoring, TRADED_FAMILIES, TRADED_TIMEFRAMES } from "../../../../lib/learning/arrow-backtest-service.ts";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Owner-only (middleware): what history is stored and the baseline indicator inputs. */
export async function GET() {
  const coverage = await arrowBacktestCoverage();
  return Response.json({ ok: true, coverage, families: TRADED_FAMILIES, timeframes: TRADED_TIMEFRAMES, baseline: DEVIANT_V1, scoring: DEFAULT_SCORING });
}

type BacktestBody = { families?: unknown; timeframes?: unknown; days?: unknown; params?: unknown; scoring?: unknown; label?: unknown };

/** Owner-only (middleware): backtest the DEVIANT arrow, optionally with changed inputs. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as BacktestBody;
  const families = Array.isArray(body.families) ? body.families.filter((f): f is string => typeof f === "string").slice(0, 4) : undefined;
  const timeframes = Array.isArray(body.timeframes) ? body.timeframes.filter((n): n is number => typeof n === "number") : undefined;
  const days = typeof body.days === "number" ? body.days : undefined;
  const label = typeof body.label === "string" ? body.label.slice(0, 60) : undefined;
  const result = await runArrowBacktests({ families, timeframes, days, params: sanitizeParams(body.params), scoring: sanitizeScoring(body.scoring), label });
  return Response.json(result, { status: result.ok ? 200 : 503 });
}
