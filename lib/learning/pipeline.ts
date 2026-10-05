import { computeFeatures } from "./features.ts";
import { buildDataset, type Dataset, type RiskModel } from "./dataset.ts";
import { deviantBaselineSignals } from "./baseline.ts";
import { entriesAsSignals, evaluateSignals, signalsFromRules, type SignalPolicy } from "./evaluate.ts";
import { extractRules, ruleMatches, trainTree } from "./tree.ts";
import { generatePine } from "./pine.ts";
import type { Bar, EvaluationMetrics, LabeledTrade, Rule, Side, SignalPoint } from "./types.ts";

export type LearningStatus = "COLLECT_MORE" | "CANDIDATE" | "NO_EDGE";

export type LearningReport = {
  status: LearningStatus;
  version: string;
  generatedAt: string;
  message: string;
  data: {
    bars: number;
    sessions: number;
    entries: number;
    longEntries: number;
    shortEntries: number;
    skippedTrades: Array<{ tradeId: string; reason: string }>;
    usedPreparedAt: number;
    window: { startMinute: number; endMinute: number };
    risk: RiskModel;
    trainDays: string[];
    testDays: string[];
  };
  rules: Rule[];
  policy: SignalPolicy;
  metrics: {
    train: EvaluationMetrics | null;
    test: EvaluationMetrics | null;
    baselineTest: EvaluationMetrics | null;
    dwightTest: EvaluationMetrics | null;
  };
  verdict: string[];
  pine: string | null;
};

export type LearningOptions = {
  /** Minimum labeled entries before any candidate is produced. */
  minEntries?: number;
  /** Fraction of sessions (oldest first) used for training. */
  trainFraction?: number;
  maxPerDay?: number;
  cooldownBars?: number;
  maxDepth?: number;
  now?: Date;
};

const DEFAULTS = { minEntries: 40, trainFraction: 0.7, maxPerDay: 2, cooldownBars: 10, maxDepth: 3 };

function versionId(now: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `v${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}`;
}

function trainSide(dataset: Dataset, side: Side, rows: number[], maxDepth: number): Rule[] {
  const { frame } = dataset;
  const positives = new Set(dataset.entries.filter((e) => e.side === side).map((e) => e.index));
  // Bars right next to an entry are ambiguous (same setup, one bar early/late): drop them as negatives.
  const near = new Set<number>();
  for (const index of positives) for (let k = -3; k <= 3; k += 1) if (k !== 0) near.add(index + k);
  const trainRows = rows.filter((row) => positives.has(row) || !near.has(row));
  const posCount = trainRows.filter((row) => positives.has(row)).length;
  if (posCount < 8) return [];
  const negCount = trainRows.length - posCount;
  const minLeafPositives = Math.max(3, Math.round(posCount * 0.12));
  const tree = trainTree(frame.columns, dataset.features, trainRows, (row) => positives.has(row), {
    maxDepth,
    minLeafPositives,
    minLeafRows: minLeafPositives,
    positiveWeight: Math.max(1, negCount / Math.max(1, posCount)) * 0.5,
    bins: 24,
  });
  return extractRules(tree, minLeafPositives).slice(0, 4).map((leaf) => {
    const support = trainRows.filter((row) => ruleMatches(leaf.conditions, frame.columns, row)).length;
    return { side, conditions: leaf.conditions, trainPrecision: leaf.precision, trainSupport: support };
  });
}

/** Greedy: keep adding rules (best precision first) while held-in recall improves within the density budget. */
function selectRules(dataset: Dataset, candidates: Rule[], policy: SignalPolicy, trainRows: Set<number>, trainDays: number): Rule[] {
  const chosen: Rule[] = [];
  let bestScore = -Infinity;
  for (const rule of [...candidates].sort((a, b) => b.trainPrecision - a.trainPrecision)) {
    const trial = [...chosen, rule];
    const signals = signalsFromRules(dataset.frame, trial, policy, trainRows);
    const metrics = evaluateSignals(dataset.frame, signals, dataset.entries.filter((e) => trainRows.has(e.index)), dataset.risk, trainDays);
    // F-score favouring agreement (precision) — fewer, better arrows.
    const p = metrics.combined.precision;
    const r = metrics.combined.recall;
    const score = p + r === 0 ? 0 : (1.25 * p * r) / (0.25 * p + r);
    if (score > bestScore + 1e-6) {
      chosen.push(rule);
      bestScore = score;
    }
  }
  return chosen;
}

export function runLearning(bars: Bar[], trades: LabeledTrade[], options: LearningOptions = {}): LearningReport {
  const opts = { ...DEFAULTS, ...options };
  const now = options.now ?? new Date();
  const version = versionId(now);
  const sorted = [...bars].sort((a, b) => a.t - b.t);
  const frame = computeFeatures(sorted);
  const dataset = buildDataset(frame, trades);
  const policyBase = { maxPerDay: opts.maxPerDay, cooldownBars: opts.cooldownBars, ...dataset.window };

  const splitAt = Math.max(1, Math.floor(dataset.days.length * opts.trainFraction));
  const trainDays = new Set(dataset.days.slice(0, splitAt));
  const testDays = new Set(dataset.days.slice(splitAt));
  const trainRows = dataset.candidates.filter((i) => trainDays.has(frame.session[i]));
  const testRows = dataset.candidates.filter((i) => testDays.has(frame.session[i]));
  const trainSet = new Set(trainRows);
  const testSet = new Set(testRows);
  const testEntries = dataset.entries.filter((e) => testSet.has(e.index));

  const baselineAll = deviantBaselineSignals(frame);
  const restrict = (signals: SignalPoint[], set: Set<number>) => signals.filter((s) => set.has(s.index));
  const baselineTest = testSet.size ? evaluateSignals(frame, restrict(baselineAll, testSet), testEntries, dataset.risk, testDays.size) : null;
  const dwightTest = testSet.size ? evaluateSignals(frame, entriesAsSignals(frame, testEntries), testEntries, dataset.risk, testDays.size) : null;

  const data: LearningReport["data"] = {
    bars: sorted.length,
    sessions: dataset.days.length,
    entries: dataset.entries.length,
    longEntries: dataset.entries.filter((e) => e.side === "LONG").length,
    shortEntries: dataset.entries.filter((e) => e.side === "SHORT").length,
    skippedTrades: dataset.skippedTrades,
    usedPreparedAt: dataset.entries.filter((e) => e.usedPreparedAt).length,
    window: dataset.window,
    risk: dataset.risk,
    trainDays: [...trainDays],
    testDays: [...testDays],
  };

  const base = { version, generatedAt: now.toISOString(), data, policy: policyBase };

  if (dataset.entries.length < opts.minEntries || testDays.size < 3) {
    return {
      ...base,
      status: "COLLECT_MORE",
      message: `${dataset.entries.length} usable entries across ${dataset.days.length} sessions with market bars. A first candidate needs at least ${opts.minEntries} entries and 3 held-out sessions.`,
      rules: [],
      metrics: { train: null, test: null, baselineTest, dwightTest },
      verdict: [
        "Keep trading normally with the Observer running and the TradingView bar feed alert active.",
        dataset.skippedTrades.length ? `${dataset.skippedTrades.length} trades could not be used (mostly missing bars) — import TradingView CSV history for those days.` : "Every journaled trade had market bars.",
      ],
      pine: null,
    };
  }

  const candidateRules = [
    ...trainSide(dataset, "LONG", trainRows, opts.maxDepth),
    ...trainSide(dataset, "SHORT", trainRows, opts.maxDepth),
  ];
  const rules = selectRules(dataset, candidateRules, policyBase, trainSet, trainDays.size);
  const trainSignals = signalsFromRules(frame, rules, policyBase, trainSet);
  const testSignals = signalsFromRules(frame, rules, policyBase, testSet);
  const train = evaluateSignals(frame, trainSignals, dataset.entries.filter((e) => trainSet.has(e.index)), dataset.risk, trainDays.size);
  const test = evaluateSignals(frame, testSignals, testEntries, dataset.risk, testDays.size);

  const verdict: string[] = [];
  const beatsBaselineRecall = !baselineTest || test.combined.recall > baselineTest.combined.recall;
  const beatsBaselineR = !baselineTest || (test.combined.avgR ?? -Infinity) >= (baselineTest.combined.avgR ?? -Infinity);
  const density = test.combined.signalsPerDay;
  verdict.push(beatsBaselineRecall ? "Matches more of your entries than DEVIANT v1 on unseen days." : "Does NOT match more of your entries than DEVIANT v1 on unseen days.");
  verdict.push(beatsBaselineR ? "Average outcome per arrow is at least as good as DEVIANT v1." : "Average outcome per arrow is worse than DEVIANT v1.");
  verdict.push(density >= 0.5 && density <= 2.5 ? `Density ${density.toFixed(2)} arrows/day is within the 1-2/day goal.` : `Density ${density.toFixed(2)} arrows/day is outside the 1-2/day goal.`);
  if (dwightTest?.combined.avgR != null && test.combined.avgR != null) {
    verdict.push(test.combined.avgR >= dwightTest.combined.avgR
      ? "With your typical stop/target, its arrows performed at least as well as your own entries on unseen days."
      : "With your typical stop/target, your own entries still performed better on unseen days.");
  }
  verdict.push("A candidate is never promoted automatically: run it in shadow mode and compare it daily before trusting it.");

  const status: LearningStatus = rules.length && beatsBaselineRecall ? "CANDIDATE" : "NO_EDGE";
  return {
    ...base,
    status,
    message: status === "CANDIDATE"
      ? `Candidate ${version}: ${rules.length} rule(s) learned from ${data.entries} entries.`
      : "No rule set beat DEVIANT v1 on unseen days yet. Keep collecting entries; the next run will retry.",
    rules,
    metrics: { train, test, baselineTest, dwightTest },
    verdict,
    pine: rules.length ? generatePine({
      version, rules, policy: policyBase, generatedAt: now.toISOString(), trainEntries: data.entries,
      sessions: data.sessions, test, baselineTest,
    }) : null,
  };
}

/** Replays a stored rule set over bars (shadow scoring without needing a TradingView alert). */
export function replayRules(bars: Bar[], rules: Rule[], policy: SignalPolicy): SignalPoint[] {
  const frame = computeFeatures([...bars].sort((a, b) => a.t - b.t));
  return signalsFromRules(frame, rules, policy);
}
