import { FEATURES, decisionBarIndex, type FeatureFrame } from "./features.ts";
import type { LabeledTrade, Side } from "./types.ts";

export type EntryLabel = { tradeId: string; side: Side; index: number; decisionAt: number; usedPreparedAt: boolean };

export type RiskModel = {
  /** Median initial stop distance in 1m ATR units across Dwight's trades. */
  stopAtr: number;
  /** Median planned target in R. */
  targetR: number;
  samples: number;
};

export type Dataset = {
  frame: FeatureFrame;
  features: string[];
  /** Bar indices eligible as training rows (watched sessions, inside the window, finite features). */
  candidates: number[];
  candidateSet: Set<number>;
  entries: EntryLabel[];
  skippedTrades: Array<{ tradeId: string; reason: string }>;
  days: string[];
  risk: RiskModel;
  window: { startMinute: number; endMinute: number };
};

const PREP_LOOKBACK_MS = 30 * 60_000;

function median(values: number[], fallback: number) {
  const clean = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!clean.length) return fallback;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

/**
 * Builds the learning dataset.
 * - A trade's label sits on the bar Dwight DECIDED on: the last bar closed before
 *   he started preparing the order (if seen within 30 min of the fill), else
 *   before the fill itself.
 * - Negatives are every other bar in sessions he traded, inside the trading window.
 */
export function buildDataset(frame: FeatureFrame, trades: LabeledTrade[], options: { startMinute?: number; endMinute?: number; extraDays?: string[] } = {}): Dataset {
  const features = FEATURES.map((f) => f.name);
  const skippedTrades: Dataset["skippedTrades"] = [];
  const entries: EntryLabel[] = [];

  for (const trade of trades) {
    const opened = Date.parse(trade.openedAt);
    if (!Number.isFinite(opened)) { skippedTrades.push({ tradeId: trade.id, reason: "invalid open time" }); continue; }
    const prepared = trade.preparedAt ? Date.parse(trade.preparedAt) : NaN;
    const usedPreparedAt = Number.isFinite(prepared) && prepared <= opened && opened - prepared <= PREP_LOOKBACK_MS;
    const decisionAt = usedPreparedAt ? prepared : opened;
    const index = decisionBarIndex(frame, decisionAt);
    if (index < 0 || frame.t[index] < decisionAt - 5 * 60_000) {
      skippedTrades.push({ tradeId: trade.id, reason: "no market bars around the entry" });
      continue;
    }
    entries.push({ tradeId: trade.id, side: trade.side, index, decisionAt, usedPreparedAt });
  }

  // Window: Dwight's own trading hours (10th-90th percentile of decision minutes, padded), default 08:00-15:00.
  const minutes = entries.map((e) => frame.nyMinute[e.index]).sort((a, b) => a - b);
  const pick = (q: number) => minutes[Math.min(minutes.length - 1, Math.max(0, Math.floor(q * (minutes.length - 1))))];
  const startMinute = options.startMinute ?? (minutes.length >= 5 ? Math.max(0, pick(0.05) - 30) : 480);
  const endMinute = options.endMinute ?? (minutes.length >= 5 ? Math.min(1439, pick(0.95) + 30) : 900);

  const dayset = new Set<string>([...entries.map((e) => frame.session[e.index]), ...(options.extraDays ?? [])]);
  const candidates: number[] = [];
  for (let i = 0; i < frame.t.length; i += 1) {
    if (!dayset.has(frame.session[i])) continue;
    const m = frame.nyMinute[i];
    if (m < startMinute || m > endMinute) continue;
    if (!Number.isFinite(frame.atr14[i]) || frame.atr14[i] <= 0) continue;
    let ok = true;
    for (const name of features) {
      if (!Number.isFinite(frame.columns[name][i])) { ok = false; break; }
    }
    if (ok) candidates.push(i);
  }
  const candidateSet = new Set(candidates);
  const usable = entries.filter((e) => {
    if (candidateSet.has(e.index)) return true;
    skippedTrades.push({ tradeId: e.tradeId, reason: "entry outside the learnable window or before indicators warmed up" });
    return false;
  });

  const tradeById = new Map(trades.map((t) => [t.id, t]));
  const stopAtrs: number[] = [];
  const targetRs: number[] = [];
  for (const entry of usable) {
    const trade = tradeById.get(entry.tradeId)!;
    const atrValue = frame.atr14[entry.index];
    if (trade.entryPrice != null && trade.initialStop != null && atrValue > 0) {
      const risk = Math.abs(trade.entryPrice - trade.initialStop);
      if (risk > 0) {
        stopAtrs.push(risk / atrValue);
        if (trade.initialTarget != null) targetRs.push(Math.abs(trade.initialTarget - trade.entryPrice) / risk);
      }
    }
  }

  return {
    frame,
    features,
    candidates,
    candidateSet,
    entries: usable,
    skippedTrades,
    days: [...new Set(candidates.map((i) => frame.session[i]))].sort(),
    risk: { stopAtr: median(stopAtrs, 1.5), targetR: median(targetRs, 2), samples: stopAtrs.length },
    window: { startMinute, endMinute },
  };
}
