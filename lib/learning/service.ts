import { appendRuntimeEvent, createRuntimeEvent } from "../jarvis-runtime";
import { priceFamily } from "../trading-symbols";
import { runLearning, replayRules, type LearningReport } from "./pipeline.ts";
import { insertSignals, listModelRuns, loadBars, loadLabeledTrades, saveModelRun } from "./store.ts";

const WARMUP_MS = 10 * 86_400_000;

/** Picks the price family Dwight trades most (NQ for MNQ/NQ, etc.). */
export async function dominantFamily(): Promise<string | null> {
  const trades = await loadLabeledTrades();
  const counts = new Map<string, number>();
  for (const trade of trades) {
    const family = priceFamily(trade.symbol);
    if (family) counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export async function runAndStoreLearning(familyInput?: string | null): Promise<{ family: string | null; id: string | null; report: LearningReport | null; reason?: string }> {
  const family = familyInput ? priceFamily(familyInput) : await dominantFamily();
  if (!family) return { family: null, id: null, report: null, reason: "No journaled trades yet." };
  const trades = await loadLabeledTrades(family);
  if (!trades.length) return { family, id: null, report: null, reason: `No journaled ${family} trades yet.` };
  const from = Date.parse(trades[0].openedAt) - WARMUP_MS;
  const bars = await loadBars(family, from, Date.now());
  if (bars.length < 2000) {
    return { family, id: null, report: null, reason: `Only ${bars.length} ${family} 1-minute bars stored. Turn on the TradingView bar feed alert and import CSV history for the days you traded.` };
  }
  const report = runLearning(bars, trades);
  const id = await saveModelRun(family, report);
  await appendRuntimeEvent(createRuntimeEvent({
    type: "trading.learning_run",
    domain: "TRADING",
    source: "jarvis.trading.learning",
    importance: report.status === "CANDIDATE" ? "IMPORTANT" : "NORMAL",
    summary: `${family} learning run · ${report.status} · ${report.message}`,
  }));
  return { family, id, report };
}

/**
 * Shadow scoring without TradingView: replays the SHADOW model's rules over the
 * last few sessions of stored bars and records what it would have signaled.
 */
export async function replayShadowModel(days = 3) {
  const runs = await listModelRuns(30);
  const shadow = runs.find((run) => run.status === "SHADOW");
  if (!shadow || !shadow.report.rules.length) return { model: null, signals: 0 };
  const now = Date.now();
  const bars = await loadBars(shadow.family, now - (days + 12) * 86_400_000, now);
  if (bars.length < 500) return { model: shadow.id, signals: 0 };
  const signals = replayRules(bars, shadow.report.rules, shadow.report.policy)
    .filter((signal) => signal.t >= now - days * 86_400_000);
  await insertSignals(signals.map((signal) => ({
    id: `${shadow.id}:${signal.t}:${signal.side}`,
    model: shadow.id,
    symbol: shadow.family,
    side: signal.side,
    ts: new Date(signal.t + 60_000).toISOString(),
    price: signal.price,
    source: "jarvis-replay",
  })));
  return { model: shadow.id, signals: signals.length };
}
