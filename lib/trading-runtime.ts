import { getCache } from "@vercel/functions";
import { appendRuntimeEvent, createRuntimeEvent } from "./jarvis-runtime";

export type TradingConnectionState = "DISCONNECTED" | "CONNECTING" | "OBSERVING" | "DEGRADED";
export type TradingStage = "PASS CURRENT ACCOUNT" | "FIRST PAYOUT" | "REPEAT PAYOUTS" | "SCALE FUNDED CAPITAL";

export type TradingAccountState = {
  provider: string;
  propFirm: string | null;
  accountLabel: string;
  accountIdMasked: string | null;
  connection: TradingConnectionState;
  stage: TradingStage;
  startingBalance: number | null;
  balance: number | null;
  equity: number | null;
  openPnl: number;
  closedPnl: number;
  profitTarget: number | null;
  dailyLossLimit: number | null;
  maxLossLimit: number | null;
  lastObservedAt: string | null;
};

export type JournalTrade = {
  id: string;
  externalId: string | null;
  symbol: string;
  side: "LONG" | "SHORT";
  quantity: number;
  status: "OPEN" | "CLOSED";
  entryPrice: number | null;
  exitPrice: number | null;
  stopPrice: number | null;
  targetPrice: number | null;
  openedAt: string;
  closedAt: string | null;
  realizedPnl: number | null;
  fees: number | null;
  source: string;
  setup: string | null;
  htfBias: string | null;
  liquidityContext: string | null;
  zoneContext: string | null;
  confirmation: string | null;
  followedRules: boolean | null;
  notes: string | null;
};

export type TradingRuntimeState = {
  version: 1;
  account: TradingAccountState;
  activeGoal: {
    title: TradingStage;
    status: "BLOCKED" | "ACTIVE" | "COMPLETE";
    progress: number | null;
    nextRightStep: string;
  };
  openTrades: JournalTrade[];
  recentTrades: JournalTrade[];
  journalCount: number;
  today: {
    trades: number;
    wins: number;
    losses: number;
    realizedPnl: number;
  };
  note: string;
};

export type TradingObservationInput = {
  provider?: string;
  propFirm?: string | null;
  accountLabel?: string;
  accountIdMasked?: string | null;
  startingBalance?: number | null;
  balance?: number | null;
  equity?: number | null;
  openPnl?: number;
  closedPnl?: number;
  profitTarget?: number | null;
  dailyLossLimit?: number | null;
  maxLossLimit?: number | null;
  stage?: TradingStage;
  trades?: Array<Partial<JournalTrade> & { symbol: string; side: "LONG" | "SHORT"; status: "OPEN" | "CLOSED" }>;
  observedAt?: string;
};

const STATE_KEY = "jarvis:runtime:trading:v1";
const TTL = 60 * 60 * 24 * 30;

const fallback = globalThis as typeof globalThis & { __jarvisTradingRuntime?: Map<string, unknown> };
const fallbackStore = fallback.__jarvisTradingRuntime ?? new Map<string, unknown>();
fallback.__jarvisTradingRuntime = fallbackStore;

async function readState(): Promise<TradingRuntimeState | null> {
  try {
    const value = await getCache().get(STATE_KEY);
    return (value ?? null) as TradingRuntimeState | null;
  } catch {
    return (fallbackStore.get(STATE_KEY) as TradingRuntimeState | undefined) ?? null;
  }
}

async function writeState(state: TradingRuntimeState) {
  fallbackStore.set(STATE_KEY, state);
  try {
    await getCache().set(STATE_KEY, state, { ttl: TTL, tags: ["jarvis-runtime", "jarvis-trading"] });
  } catch {
    // Runtime Cache can be unavailable in local/preview environments.
  }
}

export async function getTradingState(): Promise<TradingRuntimeState> {
  const existing = await readState();
  if (existing) return existing;
  const initial = buildState({
    provider: "NOT CONNECTED",
    accountLabel: "CURRENT PROP ACCOUNT",
    stage: "PASS CURRENT ACCOUNT",
    trades: [],
  }, null);
  await writeState(initial);
  return initial;
}

export async function ingestTradingObservation(input: TradingObservationInput): Promise<TradingRuntimeState> {
  const previous = await getTradingState();
  const next = buildState(input, previous);
  await writeState(next);

  const previousIds = new Set([...previous.openTrades, ...previous.recentTrades].map((trade) => trade.id));
  const newTrades = [...next.openTrades, ...next.recentTrades].filter((trade) => !previousIds.has(trade.id));
  for (const trade of newTrades.slice(0, 10)) {
    await appendRuntimeEvent(createRuntimeEvent({
      type: trade.status === "OPEN" ? "trading.position_opened" : "trading.trade_closed",
      domain: "TRADING",
      source: `jarvis.trading.${next.account.provider.toLowerCase().replace(/\s+/g, "-")}`,
      importance: trade.status === "OPEN" ? "TIME_SENSITIVE" : "NORMAL",
      summary: trade.status === "OPEN"
        ? `${trade.symbol} ${trade.side} opened · ${trade.quantity} · Jarvis is observing the position.`
        : `${trade.symbol} ${trade.side} closed${trade.realizedPnl == null ? "" : ` · ${signedMoney(trade.realizedPnl)}`} · journal updated.`,
    }));
  }

  if (previous.account.connection !== "OBSERVING" && next.account.connection === "OBSERVING") {
    await appendRuntimeEvent(createRuntimeEvent({
      type: "trading.observer_connected",
      domain: "TRADING",
      source: "jarvis.trading",
      importance: "IMPORTANT",
      summary: `${next.account.provider} trading observer connected. Jarvis can now record account state and trade events.`,
    }));
  }

  return next;
}

function buildState(input: TradingObservationInput, previous: TradingRuntimeState | null): TradingRuntimeState {
  const observedAt = normalizeDate(input.observedAt) ?? new Date().toISOString();
  const priorAccount = previous?.account;
  const incomingTrades = (input.trades ?? []).map((trade) => normalizeTrade(trade, input.provider ?? priorAccount?.provider ?? "UNKNOWN", observedAt));
  const tradeMap = new Map<string, JournalTrade>();
  for (const trade of [...(previous?.recentTrades ?? []), ...(previous?.openTrades ?? []), ...incomingTrades]) tradeMap.set(trade.id, trade);
  const allTrades = [...tradeMap.values()];
  const openTrades = allTrades.filter((trade) => trade.status === "OPEN").sort(sortNewest);
  const recentTrades = allTrades.filter((trade) => trade.status === "CLOSED").sort(sortNewest).slice(0, 100);

  const account: TradingAccountState = {
    provider: clean(input.provider ?? priorAccount?.provider ?? "NOT CONNECTED", 60),
    propFirm: nullableClean(input.propFirm ?? priorAccount?.propFirm ?? null, 80),
    accountLabel: clean(input.accountLabel ?? priorAccount?.accountLabel ?? "CURRENT PROP ACCOUNT", 80),
    accountIdMasked: nullableClean(input.accountIdMasked ?? priorAccount?.accountIdMasked ?? null, 40),
    connection: (input.provider || priorAccount?.connection === "OBSERVING") ? "OBSERVING" : "DISCONNECTED",
    stage: input.stage ?? priorAccount?.stage ?? "PASS CURRENT ACCOUNT",
    startingBalance: safeNullable(input.startingBalance ?? priorAccount?.startingBalance ?? null),
    balance: safeNullable(input.balance ?? priorAccount?.balance ?? null),
    equity: safeNullable(input.equity ?? priorAccount?.equity ?? null),
    openPnl: safeNumber(input.openPnl ?? priorAccount?.openPnl ?? 0),
    closedPnl: safeNumber(input.closedPnl ?? priorAccount?.closedPnl ?? sumPnl(recentTrades)),
    profitTarget: safeNullable(input.profitTarget ?? priorAccount?.profitTarget ?? null),
    dailyLossLimit: safeNullable(input.dailyLossLimit ?? priorAccount?.dailyLossLimit ?? null),
    maxLossLimit: safeNullable(input.maxLossLimit ?? priorAccount?.maxLossLimit ?? null),
    lastObservedAt: observedAt,
  };

  const todayKey = observedAt.slice(0, 10);
  const todayTrades = recentTrades.filter((trade) => (trade.closedAt ?? trade.openedAt).slice(0, 10) === todayKey);
  const progress = account.profitTarget && account.closedPnl > 0 ? Math.max(0, Math.min(100, (account.closedPnl / account.profitTarget) * 100)) : null;

  return {
    version: 1,
    account,
    activeGoal: {
      title: account.stage,
      status: account.connection === "OBSERVING" ? "ACTIVE" : "BLOCKED",
      progress,
      nextRightStep: account.connection === "OBSERVING"
        ? stageDirective(account)
        : "Connect the execution account read-only so Jarvis can observe fills, positions, P&L, drawdown and rule compliance without placing trades.",
    },
    openTrades,
    recentTrades,
    journalCount: recentTrades.length + openTrades.length,
    today: {
      trades: todayTrades.length,
      wins: todayTrades.filter((trade) => (trade.realizedPnl ?? 0) > 0).length,
      losses: todayTrades.filter((trade) => (trade.realizedPnl ?? 0) < 0).length,
      realizedPnl: Math.round(sumPnl(todayTrades) * 100) / 100,
    },
    note: account.connection === "OBSERVING"
      ? "Observation mode only. Jarvis records and analyzes; order placement is disabled by design."
      : "Trading journal runtime is ready. A provider connection is still required for live observation.",
  };
}

function normalizeTrade(input: Partial<JournalTrade> & { symbol: string; side: "LONG" | "SHORT"; status: "OPEN" | "CLOSED" }, source: string, observedAt: string): JournalTrade {
  const externalId = nullableClean(input.externalId ?? null, 120);
  const stable = externalId || [input.symbol, input.side, input.openedAt ?? observedAt, input.entryPrice ?? "na", input.quantity ?? 0].join(":");
  return {
    id: input.id || stable,
    externalId,
    symbol: clean(input.symbol.toUpperCase(), 40),
    side: input.side,
    quantity: Math.max(0, safeNumber(input.quantity ?? 0)),
    status: input.status,
    entryPrice: safeNullable(input.entryPrice ?? null),
    exitPrice: safeNullable(input.exitPrice ?? null),
    stopPrice: safeNullable(input.stopPrice ?? null),
    targetPrice: safeNullable(input.targetPrice ?? null),
    openedAt: normalizeDate(input.openedAt) ?? observedAt,
    closedAt: input.status === "CLOSED" ? (normalizeDate(input.closedAt) ?? observedAt) : null,
    realizedPnl: safeNullable(input.realizedPnl ?? null),
    fees: safeNullable(input.fees ?? null),
    source: clean(input.source ?? source, 60),
    setup: nullableClean(input.setup ?? null, 120),
    htfBias: nullableClean(input.htfBias ?? null, 120),
    liquidityContext: nullableClean(input.liquidityContext ?? null, 180),
    zoneContext: nullableClean(input.zoneContext ?? null, 180),
    confirmation: nullableClean(input.confirmation ?? null, 180),
    followedRules: typeof input.followedRules === "boolean" ? input.followedRules : null,
    notes: nullableClean(input.notes ?? null, 500),
  };
}

function stageDirective(account: TradingAccountState) {
  if (account.stage === "PASS CURRENT ACCOUNT") return "Protect the account first. Jarvis should learn the setups you actually take, enforce prop rules, and optimize for passing without forcing trades.";
  if (account.stage === "FIRST PAYOUT") return "Preserve the funded account and build payout eligibility without violating consistency or drawdown rules.";
  if (account.stage === "REPEAT PAYOUTS") return "Prioritize repeatable execution and payout consistency over isolated high-P&L days.";
  return "Scale funded capital only after the journal shows repeatable expectancy, rule compliance and controlled drawdown.";
}

function sortNewest(a: JournalTrade, b: JournalTrade) { return Date.parse(b.closedAt ?? b.openedAt) - Date.parse(a.closedAt ?? a.openedAt); }
function sumPnl(trades: JournalTrade[]) { return trades.reduce((sum, trade) => sum + (trade.realizedPnl ?? 0), 0); }
function safeNumber(value: number) { return Number.isFinite(value) ? value : 0; }
function safeNullable(value: number | null) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function clean(value: string, max: number) { return String(value ?? "").trim().slice(0, max) || "UNKNOWN"; }
function nullableClean(value: string | null, max: number) { const v = typeof value === "string" ? value.trim().slice(0, max) : ""; return v || null; }
function normalizeDate(value: string | null | undefined) { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null; }
function signedMoney(value: number) { return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
