import type { FeatureFrame } from "./features.ts";
import type { EntryLabel, RiskModel } from "./dataset.ts";
import { ruleMatches } from "./tree.ts";
import type { EvaluationMetrics, Rule, Side, SideMetrics, SignalPoint } from "./types.ts";

export type SignalPolicy = {
  maxPerDay: number;
  cooldownBars: number;
  startMinute: number;
  endMinute: number;
};

/**
 * Generates arrows exactly the way the generated Pine does: rules OR-ed per
 * side, inside the window, max N per session (both sides combined), and a
 * cooldown after each arrow on the same side.
 */
export function signalsFromRules(frame: FeatureFrame, rules: Rule[], policy: SignalPolicy, rows?: Set<number>): SignalPoint[] {
  const out: SignalPoint[] = [];
  let dayCount = 0;
  const lastBar: Record<Side, number> = { LONG: -1e9, SHORT: -1e9 };
  const longRules = rules.filter((r) => r.side === "LONG");
  const shortRules = rules.filter((r) => r.side === "SHORT");
  for (let i = 0; i < frame.t.length; i += 1) {
    if (i > 0 && frame.session[i] !== frame.session[i - 1]) dayCount = 0;
    if (rows && !rows.has(i)) continue;
    const m = frame.nyMinute[i];
    if (m < policy.startMinute || m > policy.endMinute || dayCount >= policy.maxPerDay) continue;
    for (const [side, set] of [["LONG", longRules], ["SHORT", shortRules]] as const) {
      if (dayCount >= policy.maxPerDay || i - lastBar[side] <= policy.cooldownBars) continue;
      if (set.some((rule) => ruleMatches(rule.conditions, frame.columns, i))) {
        out.push({ index: i, t: frame.t[i], side, price: frame.close[i] });
        lastBar[side] = i;
        dayCount += 1;
      }
    }
  }
  return out;
}

/**
 * Outcome of taking a signal with Dwight's typical risk: stop = stopAtr x ATR,
 * target = targetR x stop. Walks forward bar by bar (max 120); if one bar
 * touches both, the stop is assumed first (conservative). Returns R.
 */
export function simulateR(frame: FeatureFrame, signal: { index: number; side: Side }, risk: RiskModel, maxBars = 120): number | null {
  const i = signal.index;
  const atrValue = frame.atr14[i];
  if (!Number.isFinite(atrValue) || atrValue <= 0) return null;
  const entry = frame.close[i];
  const stopDist = risk.stopAtr * atrValue;
  const long = signal.side === "LONG";
  const stop = long ? entry - stopDist : entry + stopDist;
  const target = long ? entry + stopDist * risk.targetR : entry - stopDist * risk.targetR;
  for (let k = i + 1; k < Math.min(frame.t.length, i + 1 + maxBars); k += 1) {
    if (frame.session[k] !== frame.session[i]) break;
    const hitStop = long ? frame.low[k] <= stop : frame.high[k] >= stop;
    const hitTarget = long ? frame.high[k] >= target : frame.low[k] <= target;
    if (hitStop) return -1;
    if (hitTarget) return risk.targetR;
  }
  const last = Math.min(frame.t.length - 1, i + maxBars);
  const exit = frame.close[last];
  const r = (long ? exit - entry : entry - exit) / stopDist;
  return Math.max(-1, Math.min(risk.targetR, r));
}

function sideMetrics(frame: FeatureFrame, signals: SignalPoint[], entries: EntryLabel[], side: Side, tolerance: number, risk: RiskModel, days: number): SideMetrics {
  const sig = signals.filter((s) => s.side === side);
  const ent = entries.filter((e) => e.side === side);
  const near = (a: number, b: number) => Math.abs(a - b) <= tolerance && frame.session[a] === frame.session[b];
  const matchedEntries = ent.filter((e) => sig.some((s) => near(s.index, e.index))).length;
  const agreedSignals = sig.filter((s) => ent.some((e) => near(s.index, e.index))).length;
  const rs = sig.map((s) => simulateR(frame, s, risk)).filter((r): r is number => r !== null);
  const totalR = rs.length ? rs.reduce((a, b) => a + b, 0) : null;
  return {
    entries: ent.length,
    signals: sig.length,
    matched: matchedEntries,
    recall: ent.length ? matchedEntries / ent.length : 0,
    precision: sig.length ? agreedSignals / sig.length : 0,
    signalsPerDay: days ? sig.length / days : 0,
    avgR: rs.length ? totalR! / rs.length : null,
    totalR,
  };
}

export function evaluateSignals(frame: FeatureFrame, signals: SignalPoint[], entries: EntryLabel[], risk: RiskModel, days: number, tolerance = 3): EvaluationMetrics {
  const long = sideMetrics(frame, signals, entries, "LONG", tolerance, risk, days);
  const short = sideMetrics(frame, signals, entries, "SHORT", tolerance, risk, days);
  const entriesTotal = long.entries + short.entries;
  const signalsTotal = long.signals + short.signals;
  const rCount = signals.length;
  const totalR = (long.totalR ?? 0) + (short.totalR ?? 0);
  return {
    days,
    long,
    short,
    combined: {
      recall: entriesTotal ? (long.matched + short.matched) / entriesTotal : 0,
      precision: signalsTotal ? (long.precision * long.signals + short.precision * short.signals) / signalsTotal : 0,
      signalsPerDay: days ? signalsTotal / days : 0,
      avgR: rCount ? totalR / rCount : null,
      totalR: rCount ? totalR : null,
    },
  };
}

/** Dwight's own entries treated as signals, so the model can be compared with "how I did". */
export function entriesAsSignals(frame: FeatureFrame, entries: EntryLabel[]): SignalPoint[] {
  return entries.map((e) => ({ index: e.index, t: frame.t[e.index], side: e.side, price: frame.close[e.index] }));
}
