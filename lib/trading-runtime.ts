import { getCache } from "@vercel/functions";
import { appendRuntimeEvent, createRuntimeEvent } from "./jarvis-runtime";
import { estimatePnl, pointValue, sessionDay } from "./trading-session";
import { cachedTradingRules, getTradingRules } from "./trading-rules";
import { persistTradingTransition } from "./trading-store";
import { nextFilledAt } from "./trading-phase";

export type TradingConnectionState = "DISCONNECTED" | "CONNECTING" | "OBSERVING" | "DEGRADED";
export type TradingStage = "PASS CURRENT ACCOUNT" | "FIRST PAYOUT" | "REPEAT PAYOUTS" | "SCALE FUNDED CAPITAL";
export type TradingObserverStatus = "FLAT" | "PENDING" | "OPEN" | "UNKNOWN";
export type TradingIntentState = "NONE" | "PREPARING" | "ORDER_WORKING" | "POSITION_OPEN" | "UNKNOWN";
export type TradingRuleSeverity = "WARNING" | "VIOLATION";

export type TradingRuleAlert = {
  id: string;
  rule: "TRADE_COUNT" | "RISK_LIMIT";
  severity: TradingRuleSeverity;
  title: string;
  message: string;
  observedAt: string;
  symbol: string | null;
  side: "LONG" | "SHORT" | null;
  tradeNumber: number | null;
  plannedRisk: number | null;
};

export type TradingGuardrailState = {
  rules: {
    maxTradesPerDay: number;
    riskTargetDollars: number;
  };
  todayTradeCount: number;
  remainingTrades: number;
  plannedRisk: number | null;
  activeAlert: TradingRuleAlert | null;
  eventsToday: TradingRuleAlert[];
};

export type TradingObserverState = {
  status: TradingObserverStatus;
  symbol: string | null;
  side: "LONG" | "SHORT" | null;
  quantity: number | null;
  orderType: "LIMIT" | "STOP" | "MARKET" | null;
  entryPrice: number | null;
  currentPrice: number | null;
  stopPrice: number | null;
  targetPrice: number | null;
  openPnl: number | null;
  confidence: number;
  observedAt: string | null;
  evidence: string[];
  intentState?: TradingIntentState;
  orderTicketVisible?: boolean;
  readingIssue?: string | null;
  detailsObservedAt?: string | null;
  /** When the current position first became visible (drives the short ORDER_FILLED phase). */
  filledAt?: string | null;
};

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
  /** Learning fields: how the trade was planned and how far price went. */
  initialStop?: number | null;
  initialTarget?: number | null;
  maxQuantity?: number | null;
  mfePrice?: number | null;
  maePrice?: number | null;
  preparedAt?: string | null;
  pnlSource?: "BROKER" | "ESTIMATED" | null;
  sessionDay?: string;
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
  observer?: TradingObserverState;
  guardrails: TradingGuardrailState;
  journalCount: number;
  /** When the current order preparation / working order first appeared. */
  stagedSince?: string | null;
  today: {
    trades: number;
    wins: number;
    losses: number;
    realizedPnl: number;
  };
  note: string;
};

export type TradingObservationInput = {
  connection?: TradingConnectionState;
  observer?: Partial<TradingObserverState>;
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
const TTL = 60 * 60 * 24 * 365;

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
    connection: "DISCONNECTED",
    accountLabel: "CURRENT PROP ACCOUNT",
    stage: "PASS CURRENT ACCOUNT",
    trades: [],
  }, null);
  await writeState(initial);
  return initial;
}

export async function restoreTradingState(state: TradingRuntimeState): Promise<TradingRuntimeState> {
  if (!state || state.version !== 1 || !state.account || !state.activeGoal || !Array.isArray(state.openTrades) || !Array.isArray(state.recentTrades)) {
    throw new Error("Invalid trading runtime snapshot.");
  }
  await writeState(state);
  return state;
}

export async function ingestTradingObservation(
  input: TradingObservationInput,
  options: { durableTrades?: boolean } = {},
): Promise<TradingRuntimeState> {
  await getTradingRules().catch(() => null);
  const previous = await getTradingState();
  // A slower vision response must not replace a more recent screen state.
  const incomingAt = Date.parse(input.observedAt ?? "");
  const priorAt = Date.parse(previous.account.lastObservedAt ?? "");
  if (Number.isFinite(incomingAt) && Number.isFinite(priorAt) && incomingAt < priorAt) return previous;
  const next = buildState(input, previous);
  await writeState(next);
  try {
    await persistTradingTransition(previous, next, { trades: options.durableTrades !== false });
  } catch (error) {
    console.warn("Durable trading persistence failed", error instanceof Error ? error.message : error);
  }

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

  const priorObserver = previous.observer;
  const observer = next.observer;
  if (observer && priorObserver?.status !== observer.status) {
    await appendRuntimeEvent(createRuntimeEvent({
      type: `trading.state_${observer.status.toLowerCase()}`,
      domain: "TRADING",
      source: "jarvis.trading.observer",
      importance: observer.status === "OPEN" ? "TIME_SENSITIVE" : "NORMAL",
      summary: summarizeObserverState(observer),
    }));
  }

  if (observer && priorObserver && observer.status === "OPEN") {
    const managementChanges: string[] = [];
    if (changedNumber(priorObserver.quantity, observer.quantity)) managementChanges.push(`size ${displayNumber(priorObserver.quantity)} → ${displayNumber(observer.quantity)}`);
    if (changedNumber(priorObserver.stopPrice, observer.stopPrice)) managementChanges.push(`stop ${displayNumber(priorObserver.stopPrice)} → ${displayNumber(observer.stopPrice)}`);
    if (changedNumber(priorObserver.targetPrice, observer.targetPrice)) managementChanges.push(`target ${displayNumber(priorObserver.targetPrice)} → ${displayNumber(observer.targetPrice)}`);

    if (managementChanges.length > 0) {
      await appendRuntimeEvent(createRuntimeEvent({
        type: "trading.position_managed",
        domain: "TRADING",
        source: "jarvis.trading.observer",
        importance: "NORMAL",
        summary: `${observer.symbol ?? "Position"} managed · ${managementChanges.join(" · ")}`,
      }));
    }
  }

  const priorAlertId = previous.guardrails?.activeAlert?.id ?? null;
  const nextAlert = next.guardrails.activeAlert;
  if (nextAlert && nextAlert.id !== priorAlertId) {
    await appendRuntimeEvent(createRuntimeEvent({
      type: `trading.rule_${nextAlert.rule.toLowerCase()}`,
      domain: "TRADING",
      source: "jarvis.trading.guardrail",
      importance: "TIME_SENSITIVE",
      summary: `${nextAlert.title} · ${nextAlert.message}`,
    }));
  }

  return next;
}

function buildState(input: TradingObservationInput, previous: TradingRuntimeState | null): TradingRuntimeState {
  const observedAt = normalizeDate(input.observedAt) ?? new Date().toISOString();
  const priorAccount = previous?.account;
  const rules = cachedTradingRules();
  const connection = input.connection ?? priorAccount?.connection ?? "DISCONNECTED";
  const observer = normalizeObserver(input.observer, previous?.observer, connection === "OBSERVING" ? observedAt : null);

  const staged = observer.status === "PENDING" || (observer.intentState === "PREPARING" && observer.status !== "OPEN");
  const priorStagedSince = previous?.stagedSince ?? null;
  const stagedSince = staged ? (priorStagedSince ?? observer.observedAt ?? observedAt) : observer.status === "OPEN" ? priorStagedSince : null;

  const priorTrades = new Map<string, JournalTrade>();
  for (const trade of [...(previous?.recentTrades ?? []), ...(previous?.openTrades ?? [])]) priorTrades.set(trade.id, trade);

  const incomingTrades = (input.trades ?? []).map((trade) => normalizeTrade(trade, input.provider ?? priorAccount?.provider ?? "UNKNOWN", observedAt));
  const tradeMap = new Map<string, JournalTrade>(priorTrades);
  for (const incoming of incomingTrades) {
    const prior = priorTrades.get(incoming.id);
    tradeMap.set(incoming.id, mergeTrade(prior, incoming, priorStagedSince, rules.pointValues));
  }

  // Track best / worst price reached while each matching position is open.
  const price = observer.currentPrice;
  for (const [id, trade] of tradeMap) {
    if (trade.status !== "OPEN" || price == null) continue;
    if (observer.symbol && trade.symbol.toUpperCase() !== observer.symbol.toUpperCase()) continue;
    const better = (a: number | null | undefined, b: number) => a == null ? b : trade.side === "LONG" ? Math.max(a, b) : Math.min(a, b);
    const worse = (a: number | null | undefined, b: number) => a == null ? b : trade.side === "LONG" ? Math.min(a, b) : Math.max(a, b);
    tradeMap.set(id, { ...trade, mfePrice: better(trade.mfePrice, price), maePrice: worse(trade.maePrice, price) });
  }

  const allTrades = [...tradeMap.values()];
  const openTrades = allTrades.filter((trade) => trade.status === "OPEN").sort(sortNewest);
  const recentTrades = allTrades.filter((trade) => trade.status === "CLOSED").sort(sortNewest).slice(0, 100);

  const account: TradingAccountState = {
    provider: clean(input.provider ?? priorAccount?.provider ?? "NOT CONNECTED", 60),
    propFirm: nullableClean(input.propFirm ?? priorAccount?.propFirm ?? rules.propFirm, 80),
    accountLabel: clean(input.accountLabel ?? priorAccount?.accountLabel ?? rules.accountLabel, 80),
    accountIdMasked: nullableClean(input.accountIdMasked ?? priorAccount?.accountIdMasked ?? null, 40),
    connection,
    stage: input.stage ?? priorAccount?.stage ?? "PASS CURRENT ACCOUNT",
    startingBalance: safeNullable(input.startingBalance ?? priorAccount?.startingBalance ?? null),
    balance: safeNullable(input.balance ?? priorAccount?.balance ?? null),
    equity: safeNullable(input.equity ?? priorAccount?.equity ?? null),
    openPnl: safeNumber(input.openPnl ?? priorAccount?.openPnl ?? 0),
    closedPnl: safeNumber(input.closedPnl ?? priorAccount?.closedPnl ?? sumPnl(recentTrades)),
    profitTarget: safeNullable(input.profitTarget ?? priorAccount?.profitTarget ?? null),
    dailyLossLimit: safeNullable(input.dailyLossLimit ?? priorAccount?.dailyLossLimit ?? null),
    maxLossLimit: safeNullable(input.maxLossLimit ?? priorAccount?.maxLossLimit ?? null),
    lastObservedAt: connection === "OBSERVING" || connection === "DEGRADED" ? observedAt : (priorAccount?.lastObservedAt ?? null),
  };

  const todayKey = sessionDay(observedAt);
  const todayClosedTrades = recentTrades.filter((trade) => sessionDay(trade.closedAt ?? trade.openedAt) === todayKey);
  const todayEntries = [...openTrades, ...recentTrades].filter((trade) => sessionDay(trade.openedAt) === todayKey);
  const guardrails = buildGuardrails(observer, todayEntries, previous?.guardrails, observedAt, rules);
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
    observer,
    guardrails,
    journalCount: recentTrades.length + openTrades.length,
    stagedSince,
    today: {
      trades: todayEntries.length,
      wins: todayClosedTrades.filter((trade) => (trade.realizedPnl ?? 0) > 0).length,
      losses: todayClosedTrades.filter((trade) => (trade.realizedPnl ?? 0) < 0).length,
      realizedPnl: Math.round(sumPnl(todayClosedTrades) * 100) / 100,
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
    initialStop: safeNullable(input.initialStop ?? null),
    initialTarget: safeNullable(input.initialTarget ?? null),
    maxQuantity: safeNullable(input.maxQuantity ?? null),
    mfePrice: safeNullable(input.mfePrice ?? null),
    maePrice: safeNullable(input.maePrice ?? null),
    preparedAt: normalizeDate(input.preparedAt ?? null),
    pnlSource: input.pnlSource === "BROKER" || input.pnlSource === "ESTIMATED" ? input.pnlSource : null,
    sessionDay: sessionDay(normalizeDate(input.openedAt) ?? observedAt),
  };
}

/** Merge a fresh observation of a trade with what Jarvis already knew about it. */
function mergeTrade(prior: JournalTrade | undefined, incoming: JournalTrade, stagedSince: string | null, pointOverrides: Record<string, number>): JournalTrade {
  if (!prior) {
    return {
      ...incoming,
      initialStop: incoming.initialStop ?? incoming.stopPrice,
      initialTarget: incoming.initialTarget ?? incoming.targetPrice,
      maxQuantity: incoming.maxQuantity ?? (incoming.quantity || null),
      preparedAt: incoming.preparedAt ?? (incoming.status === "OPEN" ? stagedSince : null),
    };
  }
  const closing = incoming.status === "CLOSED" && prior.status === "OPEN";
  const quantity = closing && !incoming.quantity ? prior.quantity : incoming.quantity;
  const merged: JournalTrade = {
    ...prior,
    ...incoming,
    quantity,
    entryPrice: incoming.entryPrice ?? prior.entryPrice,
    stopPrice: incoming.stopPrice ?? prior.stopPrice,
    targetPrice: incoming.targetPrice ?? prior.targetPrice,
    openedAt: prior.openedAt,
    initialStop: prior.initialStop ?? prior.stopPrice ?? incoming.stopPrice,
    initialTarget: prior.initialTarget ?? prior.targetPrice ?? incoming.targetPrice,
    maxQuantity: Math.max(prior.maxQuantity ?? prior.quantity ?? 0, quantity ?? 0) || null,
    mfePrice: prior.mfePrice ?? incoming.mfePrice ?? null,
    maePrice: prior.maePrice ?? incoming.maePrice ?? null,
    preparedAt: prior.preparedAt ?? incoming.preparedAt ?? null,
    sessionDay: prior.sessionDay ?? incoming.sessionDay,
  };
  if (merged.status === "CLOSED") {
    if (merged.realizedPnl != null) {
      merged.pnlSource = incoming.realizedPnl != null ? "BROKER" : prior.pnlSource ?? "BROKER";
    } else {
      const estimate = estimatePnl({
        symbol: merged.symbol,
        side: merged.side,
        quantity: merged.quantity || merged.maxQuantity || null,
        entryPrice: merged.entryPrice,
        exitPrice: merged.exitPrice,
      }, pointOverrides);
      merged.realizedPnl = estimate;
      merged.pnlSource = estimate == null ? null : "ESTIMATED";
    }
  }
  return merged;
}

function normalizeObserver(
  input: Partial<TradingObserverState> | undefined,
  previous: TradingObserverState | undefined,
  observedAt: string | null,
): TradingObserverState {
  const status: TradingObserverStatus =
    input?.status === "FLAT" || input?.status === "PENDING" || input?.status === "OPEN" || input?.status === "UNKNOWN"
      ? input.status
      : previous?.status ?? "UNKNOWN";

  const side =
    input?.side === "LONG" || input?.side === "SHORT"
      ? input.side
      : input?.side === null
        ? null
        : previous?.side ?? null;

  const orderType =
    input?.orderType === "LIMIT" || input?.orderType === "STOP" || input?.orderType === "MARKET"
      ? input.orderType
      : input?.orderType === null
        ? null
        : previous?.orderType ?? null;

  return {
    status,
    symbol: normalizeObserverSymbol(input?.symbol === null ? null : nullableClean(input?.symbol ?? previous?.symbol ?? null, 40)),
    side,
    quantity: input?.quantity === null ? null : safeNullable(input?.quantity ?? previous?.quantity ?? null),
    orderType,
    entryPrice: input?.entryPrice === null ? null : safeNullable(input?.entryPrice ?? previous?.entryPrice ?? null),
    currentPrice: input?.currentPrice === null ? null : safeNullable(input?.currentPrice ?? previous?.currentPrice ?? null),
    stopPrice: input?.stopPrice === null ? null : safeNullable(input?.stopPrice ?? previous?.stopPrice ?? null),
    targetPrice: input?.targetPrice === null ? null : safeNullable(input?.targetPrice ?? previous?.targetPrice ?? null),
    openPnl: input?.openPnl === null ? null : safeNullable(input?.openPnl ?? previous?.openPnl ?? null),
    confidence: Math.max(0, Math.min(1, safeNumber(input?.confidence ?? previous?.confidence ?? 0))),
    observedAt: normalizeDate(input?.observedAt ?? observedAt ?? previous?.observedAt ?? null),
    evidence: Array.isArray(input?.evidence)
      ? input.evidence.filter((x): x is string => typeof x === "string").slice(0, 8).map((x) => x.slice(0, 160))
      : previous?.evidence ?? [],
    intentState:
      input?.intentState === "NONE" || input?.intentState === "PREPARING" || input?.intentState === "ORDER_WORKING" || input?.intentState === "POSITION_OPEN" || input?.intentState === "UNKNOWN"
        ? input.intentState
        : previous?.intentState ?? "UNKNOWN",
    orderTicketVisible:
      typeof input?.orderTicketVisible === "boolean"
        ? input.orderTicketVisible
        : previous?.orderTicketVisible ?? false,
    readingIssue: input?.readingIssue === undefined ? previous?.readingIssue ?? null : nullableClean(input.readingIssue, 200),
    detailsObservedAt: normalizeDate(input?.detailsObservedAt ?? input?.observedAt ?? observedAt ?? null),
    filledAt: nextFilledAt(previous, status, normalizeDate(input?.observedAt ?? observedAt ?? null)),
  };
}

function buildGuardrails(
  observer: TradingObserverState,
  todayEntries: JournalTrade[],
  previous: TradingGuardrailState | undefined,
  observedAt: string,
  rules = cachedTradingRules(),
): TradingGuardrailState {
  const maxTradesPerDay = rules.maxTradesPerDay;
  const riskTargetDollars = rules.riskTargetDollars;
  const todayTradeCount = todayEntries.length;
  const remainingTrades = Math.max(0, maxTradesPerDay - todayTradeCount);
  const plannedRisk = estimatePlannedRisk(observer, rules.pointValues);
  const preparing = observer.intentState === "PREPARING" || observer.status === "PENDING";
  let activeAlert: TradingRuleAlert | null = null;

  if (preparing && todayTradeCount >= maxTradesPerDay) {
    activeAlert = {
      id: `${sessionDay(observedAt)}:TRADE_COUNT:${todayTradeCount + 1}`,
      rule: "TRADE_COUNT",
      severity: "VIOLATION",
      title: "TRADE LIMIT",
      message: `${todayTradeCount}/${maxTradesPerDay} trades already used today. This setup would exceed your daily trade rule.`,
      observedAt,
      symbol: observer.symbol,
      side: observer.side,
      tradeNumber: todayTradeCount + 1,
      plannedRisk,
    };
  } else if (preparing && plannedRisk != null && plannedRisk > riskTargetDollars) {
    activeAlert = {
      id: `${sessionDay(observedAt)}:RISK_LIMIT:${Math.round(plannedRisk)}`,
      rule: "RISK_LIMIT",
      severity: "WARNING",
      title: "RISK LIMIT",
      message: `Planned risk is about ${Math.round(plannedRisk)}. Your current risk target is ${riskTargetDollars}.`,
      observedAt,
      symbol: observer.symbol,
      side: observer.side,
      tradeNumber: todayTradeCount + 1,
      plannedRisk,
    };
  }

  const previousEvents = (previous?.eventsToday ?? []).filter((event) => sessionDay(event.observedAt) === sessionDay(observedAt));
  const eventsToday = [...previousEvents];
  if (activeAlert && !eventsToday.some((event) => event.id === activeAlert!.id)) eventsToday.push(activeAlert);

  return {
    rules: { maxTradesPerDay, riskTargetDollars },
    todayTradeCount,
    remainingTrades,
    plannedRisk,
    activeAlert,
    eventsToday: eventsToday.slice(-50),
  };
}

function estimatePlannedRisk(observer: TradingObserverState, overrides?: Record<string, number>): number | null {
  if (observer.entryPrice == null || observer.stopPrice == null || observer.quantity == null || observer.quantity <= 0 || !observer.symbol) return null;
  const value = pointValue(observer.symbol, overrides);
  if (value == null) return null;
  const risk = Math.abs(observer.entryPrice - observer.stopPrice) * value * observer.quantity;
  return Number.isFinite(risk) ? Math.round(risk * 100) / 100 : null;
}

function summarizeObserverState(observer: TradingObserverState) {
  const symbol = observer.symbol ?? "Market";
  if (observer.status === "PENDING") {
    return `${symbol} pending ${observer.side ?? "order"}${observer.quantity == null ? "" : ` · ${observer.quantity}`}${observer.entryPrice == null ? "" : ` @ ${displayNumber(observer.entryPrice)}`}`;
  }
  if (observer.status === "OPEN") {
    return `${symbol} ${observer.side ?? "position"} open${observer.quantity == null ? "" : ` · ${observer.quantity}`}${observer.entryPrice == null ? "" : ` @ ${displayNumber(observer.entryPrice)}`}`;
  }
  if (observer.status === "FLAT") return `${symbol} flat · no live position detected.`;
  return `${symbol} observer state unknown · waiting for clearer evidence.`;
}

function normalizeObserverSymbol(value: string | null) {
  if (!value) return null;
  const symbol = value.trim().toUpperCase();
  const reserved = new Set(["CLASS", "BUTTON", "GROUP", "TEXT", "ORDER", "ORDERS", "POSITION", "POSITIONS", "BUY", "SELL", "UNKNOWN"]);
  if (!symbol || reserved.has(symbol)) return null;
  return symbol.slice(0, 40);
}

function changedNumber(before: number | null, after: number | null) {
  if (before == null && after == null) return false;
  if (before == null || after == null) return true;
  return Math.abs(before - after) > 0.000001;
}

function displayNumber(value: number | null) {
  return value == null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 4 });
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
function signedMoney(value: number) { return `${value >= 0 ? "+" : "-"}${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
