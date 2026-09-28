"server-only";

import { getFinanceState, getLatestPulse, getRecentEvents, getWorkforceState } from "./jarvis-runtime";
import { getTradingState } from "./trading-runtime";
import { getTradingPayoutSummary } from "./trading-payouts";
import { getAssistantRuntimeState, getAssistantAlerts } from "./jarvis-assistant-runtime";

type SafeResult<T> = { ok: true; value: T } | { ok: false; error: string };

async function safe<T>(fn: () => Promise<T>): Promise<SafeResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function compactFinance(value: Awaited<ReturnType<typeof getFinanceState>>) {
  if (!value) return null;
  return {
    asOf: value.asOf,
    mode: value.mode,
    source: value.source,
    currentStage: value.currentStage,
    nextStage: value.nextStage,
    metrics: value.metrics,
    goals: value.goals.slice(0, 8),
    accounts: value.accounts.slice(0, 18).map(account => ({
      key: account.key,
      institution: account.institution,
      name: account.name,
      type: account.type,
      ownership: account.ownership,
      role: account.role,
      current: account.current,
      available: account.available,
      limit: account.limit,
      balanceAsOf: account.balanceAsOf ?? null,
    })),
    liabilities: value.liabilities.slice(0, 18),
    note: value.note,
  };
}

function compactAssistant(value: Awaited<ReturnType<typeof getAssistantRuntimeState>>) {
  const now = Date.now();
  const events = [...value.calendar.events]
    .filter(event => event.status !== "CANCELLED")
    .sort((a, b) => Math.abs(Date.parse(a.startAt) - now) - Math.abs(Date.parse(b.startAt) - now))
    .slice(0, 12);

  const presence = [...value.meetingPresence.people]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 12);

  const communications = [...value.communications.recent]
    .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))
    .slice(0, 16);

  return {
    updatedAt: value.updatedAt,
    sources: value.sources,
    calendar: { asOf: value.calendar.asOf, events },
    meetingPresence: { asOf: value.meetingPresence.asOf, people: presence },
    communications: { asOf: value.communications.asOf, recent: communications },
  };
}

function compactTrading(value: Awaited<ReturnType<typeof getTradingState>>) {
  return {
    account: value.account,
    activeGoal: value.activeGoal,
    observer: value.observer ?? null,
    guardrails: value.guardrails,
    today: value.today,
    openTrades: value.openTrades.slice(0, 8),
    recentTrades: value.recentTrades.slice(0, 12),
    journalCount: value.journalCount,
    note: value.note,
  };
}

export async function getJarvisRuntimeContext() {
  const [finance, trading, payouts, assistant, workforce, pulse, events] = await Promise.all([
    safe(() => getFinanceState()),
    safe(() => getTradingState()),
    safe(() => getTradingPayoutSummary("ALL")),
    safe(() => getAssistantRuntimeState()),
    safe(() => getWorkforceState()),
    safe(() => getLatestPulse()),
    safe(() => getRecentEvents()),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    finance: finance.ok ? compactFinance(finance.value) : { unavailable: true, error: finance.error },
    trading: trading.ok ? compactTrading(trading.value) : { unavailable: true, error: trading.error },
    tradingPayouts: payouts.ok ? payouts.value : { unavailable: true, error: payouts.error },
    assistant: assistant.ok ? compactAssistant(assistant.value) : { unavailable: true, error: assistant.error },
    assistantAlerts: assistant.ok ? getAssistantAlerts(assistant.value) : [],
    workforce: workforce.ok ? workforce.value : { unavailable: true, error: workforce.error },
    researchPulse: pulse.ok ? pulse.value : { unavailable: true, error: pulse.error },
    recentEvents: events.ok ? events.value.slice(0, 16) : [],
    sourceHealth: {
      finance: finance.ok,
      trading: trading.ok,
      payouts: payouts.ok,
      assistant: assistant.ok,
      workforce: workforce.ok,
      research: pulse.ok,
      events: events.ok,
    },
  };
}

export type JarvisRuntimeContext = Awaited<ReturnType<typeof getJarvisRuntimeContext>>;
