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

const HABIT_KEY = "jarvis-habit-history-v1";

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
      const passed = hasEvent(events, "trading.account_passed");
      const payout = hasEvent(events, "trading.payout_received");
      const reviewDone = habits.days[dateKey()]?.["trading.review"] === true;
      const reviewRate = habitRate(habits, "trading.review", 7);
      return [
        {
          name: "REVIEW TRADE",
          status: reviewDone ? "DONE" : "ACTIVE",
          detail: reviewRate == null
            ? "Manual check-off after you trade. Jarvis will score consistency automatically once Observer trade days are flowing."
            : `${Math.round(reviewRate)}% of the last observed trading days reviewed · streak ${habitStreak(habits, "trading.review")}.`,
          progress: reviewDone ? 100 : 0,
          active: !reviewDone,
          habitId: "trading.review",
        },
        { name: "PASS CURRENT ACCOUNT", status: passed ? "DONE" : "ACTIVE", detail: passed ? "Passed." : "Current objective. Progress will automate once trading data is connected.", progress: passed ? 100 : null, active: !passed },
        { name: "FIRST PAYOUT", status: payout ? "DONE" : passed ? "ACTIVE" : "NEXT", detail: payout ? "Payout recorded." : "Unlocks after the account is funded.", progress: payout ? 100 : null, active: passed && !payout },
        { name: "REPEAT PAYOUTS", status: payout ? "ACTIVE" : "LOCKED", detail: "Build consistency before scaling risk.", progress: null, active: payout },
        { name: "SCALE FUNDED CAPITAL", status: "LOCKED", detail: "Scale only after repeatable payout evidence.", progress: null },
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
  }, [domain, events, finance, habits, summary, todayKey]);

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
