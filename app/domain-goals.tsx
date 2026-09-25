"use client";

import { useEffect, useMemo, useState } from "react";
import type { FinanceRuntimeState } from "../lib/jarvis-runtime";

type Domain = "TRADING" | "FINANCE" | "SENTRYOPS" | "LIFE";
type GoalEvent = { type: string; occurredAt?: string };

type GoalItem = {
  name: string;
  status: string;
  detail: string;
  progress: number | null;
  active?: boolean;
  habitId?: HabitId;
};

type HabitId = "life.bible" | "life.gym" | "life.read30" | "life.phonefree" | "trading.review";

type HabitStore = {
  version: 1;
  startedOn: string;
  days: Record<string, Partial<Record<HabitId, boolean>>>;
  tradingDays: Record<string, true>;
};

type TradingGoalAccount = {
  id: string;
  firm: string;
  label: string;
  stage: "EVAL" | "FUNDED";
  startBalance: number;
  currentBalance: number;
  lossLimit: number;
  profitTarget: number;
  fundedBuffer: number;
  requiredTradingDays: number;
  cycle: number;
};

type TradingGoalSnapshot = {
  account: TradingGoalAccount;
  tradingDays: number;
  totalPnl: number;
  targetBalance: number;
  remaining: number;
  progress: number;
  dayProgress: number;
};

type TradingGoalRuntime = {
  account?: {
    connection?: string;
    stage?: string;
    balance?: number | null;
    closedPnl?: number;
  };
  observer?: {
    status?: string;
    openPnl?: number | null;
  };
  guardrails?: {
    rules?: { maxTradesPerDay?: number; riskTargetDollars?: number };
    todayTradeCount?: number;
    remainingTrades?: number;
    plannedRisk?: number | null;
    activeAlert?: { severity?: string; title?: string } | null;
  };
  today?: {
    trades?: number;
    wins?: number;
    losses?: number;
    realizedPnl?: number;
  };
  activeGoal?: {
    title?: string;
    status?: string;
    progress?: number | null;
    nextRightStep?: string;
  };
};

type TradingGoalPayoutSummary = {
  connected?: boolean;
  lifetimeCount?: number;
  nextPayoutNumber?: number;
  latest?: { approvedAt: string; traderNetAmount: number } | null;
};

const HABIT_KEY = "jarvis-habit-history-v1";
const TRADING_ACCOUNTS_KEY = "jarvis-trading-accounts-v1";
const TRADING_SELECTED_KEY = "jarvis-trading-selected-account-v1";
const TRADING_JOURNAL_KEY = "jarvis-trading-journal-v1";

const LIFE_HABITS: Array<{ id: HabitId; name: string }> = [
  { id: "life.bible", name: "READ BIBLE" },
  { id: "life.gym", name: "TRAIN / PLANNED RECOVERY" },
  { id: "life.read30", name: "READ 30 MINUTES" },
  { id: "life.phonefree", name: "PHONE OFF 30–60 MIN" },
];

function percentLabel(value: number) {
  if (value > 0 && value < 0.01) return "<0.01%";
  return `${Math.round(value * 10) / 10}%`;
}

function dollars(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function loadTradingGoalSnapshot(): TradingGoalSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const rawAccounts = window.localStorage.getItem(TRADING_ACCOUNTS_KEY);
    if (!rawAccounts) return null;
    const accounts = JSON.parse(rawAccounts) as TradingGoalAccount[];
    if (!Array.isArray(accounts) || accounts.length === 0) return null;

    const selectedId = window.localStorage.getItem(TRADING_SELECTED_KEY);
    const account = accounts.find((item) => item.id === selectedId) ?? accounts[0];
    const journalRaw = window.localStorage.getItem(TRADING_JOURNAL_KEY);
    const journal = journalRaw ? JSON.parse(journalRaw) as Record<string, { pnl?: number | null; notes?: string; hasImage?: boolean }> : {};
    const prefix = `${account.id}:cycle-${account.cycle}:${account.stage}:`;
    const entries = Object.entries(journal).filter(([key]) => key.startsWith(prefix));
    const tradingDays = entries.filter(([, entry]) => entry.pnl != null || Boolean(entry.notes?.trim()) || entry.hasImage === true).length;
    const totalPnl = entries.reduce((sum, [, entry]) => sum + (typeof entry.pnl === "number" ? entry.pnl : 0), 0);
    const targetBalance = account.stage === "EVAL"
      ? account.startBalance + Math.max(0, account.profitTarget)
      : account.startBalance + Math.max(0, account.fundedBuffer);
    const denominator = targetBalance - account.lossLimit;
    const progress = denominator > 0
      ? Math.max(0, Math.min(100, ((account.currentBalance - account.lossLimit) / denominator) * 100))
      : 0;
    const remaining = Math.max(0, targetBalance - account.currentBalance);
    const dayProgress = account.requiredTradingDays > 0
      ? Math.max(0, Math.min(100, (tradingDays / account.requiredTradingDays) * 100))
      : 0;

    return { account, tradingDays, totalPnl, targetBalance, remaining, progress, dayProgress };
  } catch {
    return null;
  }
}

function tone(goal: GoalItem) {
  if (goal.status === "DONE" || goal.status === "GREEN") return "goal-good";
  if (goal.active || goal.status === "ACTIVE" || goal.status === "YELLOW") return "goal-watch";
  return "goal-risk";
}

function hasEvent(events: GoalEvent[], type: string) {
  return events.some((event) => event.type === type);
}

function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateKey(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

function emptyHabitStore(): HabitStore {
  return { version: 1, startedOn: dateKey(), days: {}, tradingDays: {} };
}

function loadHabitStore(): HabitStore {
  if (typeof window === "undefined") return emptyHabitStore();
  try {
    const raw = window.localStorage.getItem(HABIT_KEY);
    if (!raw) return emptyHabitStore();
    const parsed = JSON.parse(raw) as Partial<HabitStore>;
    if (parsed.version !== 1 || typeof parsed.startedOn !== "string") return emptyHabitStore();
    return {
      version: 1,
      startedOn: parsed.startedOn,
      days: parsed.days && typeof parsed.days === "object" ? parsed.days : {},
      tradingDays: parsed.tradingDays && typeof parsed.tradingDays === "object" ? parsed.tradingDays : {},
    };
  } catch {
    return emptyHabitStore();
  }
}

function saveHabitStore(store: HabitStore) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(HABIT_KEY, JSON.stringify(store));
  window.dispatchEvent(new CustomEvent("jarvis-habits-updated", { detail: buildHabitSummary(store) }));
}

function datesBetween(startKey: string, endKey: string, maxDays = 30) {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end && dates.length < maxDays) {
    dates.push(dateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function recentLifeDates(store: HabitStore, days: number) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - (days - 1));
  const actualStart = parseDateKey(store.startedOn) > start ? parseDateKey(store.startedOn) : start;
  return datesBetween(dateKey(actualStart), dateKey(today), days);
}

function habitRate(store: HabitStore, id: HabitId, days = 7) {
  const dates = id === "trading.review"
    ? Object.keys(store.tradingDays).sort().slice(-days)
    : recentLifeDates(store, days);
  if (dates.length === 0) return null;
  const done = dates.filter((day) => store.days[day]?.[id] === true).length;
  return (done / dates.length) * 100;
}

function habitStreak(store: HabitStore, id: HabitId) {
  const today = new Date();
  let streak = 0;
  for (let i = 0; i < 365; i += 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - i);
    const key = dateKey(day);
    if (id === "trading.review" && !store.tradingDays[key]) continue;
    if (store.days[key]?.[id] === true) streak += 1;
    else break;
  }
  return streak;
}

function buildHabitSummary(store: HabitStore) {
  const lifeRates = LIFE_HABITS.map((habit) => habitRate(store, habit.id, 7)).filter((value): value is number => value != null);
  const overall = lifeRates.length ? lifeRates.reduce((sum, value) => sum + value, 0) / lifeRates.length : null;
  const trackedDays = recentLifeDates(store, 30).length;
  const verdict = trackedDays < 3 || overall == null
    ? "BUILDING DATA"
    : overall >= 85
      ? "CONSISTENT"
      : overall >= 60
        ? "SLIPPING"
        : "RESET & RECOMMIT";
  return {
    verdict,
    life7DayCompletion: overall == null ? null : Math.round(overall),
    trackedDays,
    tradingReview7DayCompletion: habitRate(store, "trading.review", 7),
  };
}

export default function DomainGoals({ domain, events }: { domain: Domain; events: GoalEvent[] }) {
  const [finance, setFinance] = useState<FinanceRuntimeState | null>(null);
  const [habits, setHabits] = useState<HabitStore>(() => emptyHabitStore());
  const [todayKey, setTodayKey] = useState(dateKey);
  const [tradingRuntime, setTradingRuntime] = useState<TradingGoalRuntime | null>(null);
  const [tradingPayouts, setTradingPayouts] = useState<TradingGoalPayoutSummary | null>(null);
  const [tradingAccount, setTradingAccount] = useState<TradingGoalSnapshot | null>(null);

  useEffect(() => {
    const loaded = loadHabitStore();
    setHabits(loaded);
    if (!window.localStorage.getItem(HABIT_KEY)) saveHabitStore(loaded);
    const refresh = () => { setHabits(loadHabitStore()); setTodayKey(dateKey()); };
    const sync = (event: StorageEvent) => { if (event.key === HABIT_KEY || event.key === null) refresh(); };
    const timer = window.setInterval(() => setTodayKey(dateKey()), 30_000);
    window.addEventListener("storage", sync);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("storage", sync); window.removeEventListener("focus", refresh); };
  }, []);

  useEffect(() => {
    if (domain !== "FINANCE") return;
    let cancelled = false;
    async function refresh() {
      try {
        const response = await fetch("/api/finance/state", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { state?: FinanceRuntimeState };
        if (!cancelled && body.state) setFinance(body.state);
      } catch {}
    }
    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [domain]);


  useEffect(() => {
    if (domain !== "TRADING") return;

    const refreshLocal = () => setTradingAccount(loadTradingGoalSnapshot());
    refreshLocal();

    const syncStorage = (event: StorageEvent) => {
      if (!event.key || [TRADING_ACCOUNTS_KEY, TRADING_SELECTED_KEY, TRADING_JOURNAL_KEY].includes(event.key)) refreshLocal();
    };

    window.addEventListener("storage", syncStorage);
    window.addEventListener("focus", refreshLocal);
    window.addEventListener("jarvis-trading-account-updated", refreshLocal as EventListener);

    return () => {
      window.removeEventListener("storage", syncStorage);
      window.removeEventListener("focus", refreshLocal);
      window.removeEventListener("jarvis-trading-account-updated", refreshLocal as EventListener);
    };
  }, [domain]);

  useEffect(() => {
    if (domain !== "TRADING") return;
    let cancelled = false;

    async function refreshRuntime() {
      try {
        const response = await fetch("/api/trading/state", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { state?: TradingGoalRuntime };
        if (!cancelled && body.state) setTradingRuntime(body.state);
      } catch {}
    }

    async function refreshPayouts() {
      try {
        const response = await fetch("/api/trading/payouts?range=ALL", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { summary?: TradingGoalPayoutSummary };
        if (!cancelled && body.summary) setTradingPayouts(body.summary);
      } catch {}
    }

    void refreshRuntime();
    void refreshPayouts();
    const runtimeTimer = window.setInterval(refreshRuntime, 2_000);
    const payoutTimer = window.setInterval(refreshPayouts, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(runtimeTimer);
      window.clearInterval(payoutTimer);
    };
  }, [domain]);

  useEffect(() => {
    const tradeDays = events
      .filter((event) => event.type === "trading.trade_closed" && event.occurredAt)
      .map((event) => dateKey(new Date(event.occurredAt as string)));
    if (tradeDays.length === 0) return;
    setHabits((current) => {
      const tradingDays = { ...current.tradingDays };
      let changed = false;
      for (const day of tradeDays) {
        if (!tradingDays[day]) { tradingDays[day] = true; changed = true; }
      }
      if (!changed) return current;
      const next = { ...current, tradingDays };
      saveHabitStore(next);
      return next;
    });
  }, [events]);

  const summary = useMemo(() => buildHabitSummary(habits), [habits, todayKey]);

  const goals = useMemo<GoalItem[]>(() => {
    if (domain === "TRADING") {
      const reviewDone = habits.days[dateKey()]?.["trading.review"] === true;
      const reviewRate = habitRate(habits, "trading.review", 7);
      const payoutCount = Math.max(0, tradingPayouts?.lifetimeCount ?? (hasEvent(events, "trading.payout_received") ? 1 : 0));
      const nextPayoutNumber = tradingPayouts?.nextPayoutNumber ?? (payoutCount + 1);
      const fifthPayoutProgress = Math.min(100, (payoutCount / 5) * 100);
      const latestPayout = tradingPayouts?.latest;
      const latestPayoutDetail = latestPayout
        ? `Last payout ${dollars(latestPayout.traderNetAmount)} · ${new Date(latestPayout.approvedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.`
        : "Waiting for the latest payout record.";

      const accountGoal: GoalItem = tradingAccount
        ? tradingAccount.account.stage === "EVAL"
          ? {
              name: "CURRENT ACCOUNT",
              status: tradingAccount.remaining <= 0 ? "DONE" : "ACTIVE",
              detail: `${tradingAccount.account.label} · balance ${dollars(tradingAccount.account.currentBalance)} · ${dollars(tradingAccount.remaining)} to pass · MLL ${dollars(tradingAccount.account.lossLimit)}.`,
              progress: tradingAccount.progress,
              active: tradingAccount.remaining > 0,
            }
          : {
              name: "CURRENT FUNDED ACCOUNT",
              status: tradingAccount.remaining <= 0 && tradingAccount.dayProgress >= 100 ? "DONE" : "ACTIVE",
              detail: `${tradingAccount.account.label} · ${dollars(tradingAccount.remaining)} buffer left · ${tradingAccount.tradingDays}/${tradingAccount.account.requiredTradingDays} qualifying days.`,
              progress: Math.min(tradingAccount.progress, tradingAccount.dayProgress || tradingAccount.progress),
              active: tradingAccount.remaining > 0 || tradingAccount.dayProgress < 100,
            }
        : {
            name: "CURRENT ACCOUNT",
            status: tradingRuntime?.activeGoal?.status === "COMPLETE" ? "DONE" : "ACTIVE",
            detail: tradingRuntime?.activeGoal?.nextRightStep ?? "Waiting for the selected account details.",
            progress: tradingRuntime?.activeGoal?.progress ?? null,
            active: tradingRuntime?.activeGoal?.status !== "COMPLETE",
          };

      const maxTrades = tradingRuntime?.guardrails?.rules?.maxTradesPerDay;
      const todayTrades = tradingRuntime?.guardrails?.todayTradeCount ?? tradingRuntime?.today?.trades ?? 0;
      const observerOnline = tradingRuntime?.account?.connection === "OBSERVING";
      const alert = tradingRuntime?.guardrails?.activeAlert;

      return [
        accountGoal,
        {
          name: "5TH PAYOUT",
          status: payoutCount >= 5 ? "DONE" : "ACTIVE",
          detail: `${payoutCount}/5 payouts completed · ${latestPayoutDetail} ${payoutCount < 5 ? `Payout #${nextPayoutNumber} is the target.` : "Milestone complete."}`,
          progress: fifthPayoutProgress,
          active: payoutCount < 5,
        },
        {
          name: "LIVE EXECUTION",
          status: observerOnline ? (alert ? "YELLOW" : "GREEN") : "WAITING",
          detail: observerOnline
            ? `Observer online · ${todayTrades}${maxTrades ? `/${maxTrades}` : ""} trades today${alert ? ` · ${alert.title ?? "guardrail alert"}` : ""}.`
            : "Goal Readiness is linked to the Trading Observer and will update when the observer is online.",
          progress: null,
          active: !observerOnline || Boolean(alert),
        },
        {
          name: "REVIEW TRADE",
          status: reviewDone ? "DONE" : "ACTIVE",
          detail: reviewRate == null
            ? "Check off the review after trading. Observer trade days feed this automatically."
            : `${Math.round(reviewRate)}% of the last observed trading days reviewed · streak ${habitStreak(habits, "trading.review")}.`,
          progress: reviewDone ? 100 : 0,
          active: !reviewDone,
          habitId: "trading.review",
        },
        {
          name: "SCALE FUNDED CAPITAL",
          status: payoutCount >= 5 ? "NEXT" : "LOCKED",
          detail: payoutCount >= 5
            ? "Five payouts are proven. Scale only while account buffer, drawdown and execution discipline remain healthy."
            : "Unlock after payout #5 so scale follows repeatable payout evidence instead of account size alone.",
          progress: null,
          active: payoutCount >= 5,
        },
      ];
    }

    if (domain === "SENTRYOPS") {
      const prototype = hasEvent(events, "sentryops.prototype_completed");
      const customer = hasEvent(events, "sentryops.first_customer_closed");
      return [
        { name: "COMPLETE PROTOTYPE", status: prototype ? "DONE" : "ACTIVE", detail: prototype ? "Prototype complete." : "Current build objective.", progress: prototype ? 100 : null, active: !prototype },
        { name: "PILOT-READY DEMO", status: prototype ? "ACTIVE" : "NEXT", detail: "Make the product demonstrably useful to a real agency buyer.", progress: null, active: prototype && !customer },
        { name: "CLOSE FIRST CUSTOMER", status: customer ? "DONE" : "NEXT", detail: customer ? "First customer closed." : "Convert validated pain into the first paid customer.", progress: customer ? 100 : null },
        { name: "REPEATABLE SALES", status: customer ? "ACTIVE" : "LOCKED", detail: "Turn one win into a repeatable agency sales motion.", progress: null, active: customer },
      ];
    }

    if (domain === "LIFE") {
      const habitGoals = LIFE_HABITS.map<GoalItem>((habit) => {
        const done = habits.days[dateKey()]?.[habit.id] === true;
        const rate = habitRate(habits, habit.id, 7);
        return {
          name: habit.name,
          status: done ? "DONE" : "ACTIVE",
          detail: `${rate == null ? "No history yet" : `${Math.round(rate)}% last 7D`} · streak ${habitStreak(habits, habit.id)}.`,
          progress: done ? 100 : 0,
          active: !done,
          habitId: habit.id,
        };
      });
      return [
        ...habitGoals,
        { name: "CONSISTENCY CHECK", status: summary.verdict, detail: summary.life7DayCompletion == null ? "Jarvis is building your baseline." : `${summary.life7DayCompletion}% average completion across your daily Life check-offs.`, progress: summary.life7DayCompletion, active: summary.verdict !== "CONSISTENT" },
        { name: "MOVE OUT READINESS", status: "LINKED TO FINANCE", detail: "Moves only when Finance gates are actually satisfied.", progress: null },
        { name: "LIFESTYLE UPGRADE", status: "LINKED TO FINANCE", detail: "Lifestyle expands after cash flow, debt, credit and reserves support it.", progress: null },
      ];
    }

    const metrics = finance?.metrics;
    if (!metrics) return [{ name: "FINANCE STATE", status: "LOADING", detail: "Reading the latest Finance runtime state.", progress: null, active: true }];

    const step = metrics.personalNetWorth < 100_000 ? 5_000 : 10_000;
    const floor = Math.floor(Math.max(0, metrics.personalNetWorth) / step) * step;
    const target = floor + step;
    const wealthProgress = metrics.personalNetWorth <= floor ? 0 : Math.min(100, ((metrics.personalNetWorth - floor) / step) * 100);
    const cash100M = Math.max(0, Math.min(100, (metrics.liquidity / 100_000_000) * 100));

    return [
      { name: "DEBT FREEDOM", status: metrics.personalDebt <= 0 ? "DONE" : "ACTIVE", detail: metrics.personalDebt <= 0 ? "$0 personal revolving debt." : `$${metrics.personalDebt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} personal debt remains.`, progress: metrics.personalDebt <= 0 ? 100 : null, active: metrics.personalDebt > 0 },
      { name: `NEXT $${target.toLocaleString()} NET WORTH`, status: metrics.personalNetWorth >= target ? "DONE" : "ACTIVE", detail: metrics.personalNetWorth < 0 ? "0% until adjusted net worth is positive." : `Current adjusted net worth: $${metrics.personalNetWorth.toLocaleString(undefined, { maximumFractionDigits: 2 })}.`, progress: wealthProgress, active: metrics.personalDebt <= 0 },
      { name: "MOVE OUT", status: "SETUP", detail: "Needs locked housing budget, cash floor and income-consistency gates.", progress: null },
      { name: "GR SUPRA", status: "SETUP", detail: "Unlocks only when purchase + insurance + post-purchase cash gates are safe.", progress: null },
      { name: "$100M CASH", status: "ULTIMATE", detail: `$${metrics.liquidity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} current connected cash.`, progress: cash100M },
    ];
  }, [domain, events, finance, habits, summary, todayKey, tradingAccount, tradingPayouts, tradingRuntime]);

  function toggleHabit(id: HabitId) {
    const today = dateKey();
    setHabits((current) => {
      const existing = current.days[today]?.[id] === true;
      const days = {
        ...current.days,
        [today]: { ...current.days[today], [id]: !existing },
      };
      const tradingDays = id === "trading.review" ? { ...current.tradingDays, [today]: true as const } : current.tradingDays;
      const next = { ...current, days, tradingDays };
      saveHabitStore(next);
      return next;
    });
  }

  return (
    <div className="goal-list">
      {goals.map((goal) => {
        const checked = goal.habitId ? habits.days[dateKey()]?.[goal.habitId] === true : false;
        return (
          <div className={`goal ${tone(goal)}`} key={goal.name}>
            <div className="goal-head"><span>{goal.name}</span><b>{goal.progress == null ? goal.status : percentLabel(goal.progress)}</b></div>
            {goal.progress != null && <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, goal.progress))}%` }} /></div>}
            <div className="tiny-row">
              <span>{goal.detail}</span>
              {goal.habitId ? <input aria-label={`Mark ${goal.name} complete`} type="checkbox" checked={checked} onChange={() => toggleHabit(goal.habitId as HabitId)} /> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
