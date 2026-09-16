"use client";

import { useEffect, useMemo, useState } from "react";
import type { FinanceRuntimeState, RuntimeEvent } from "../lib/jarvis-runtime";

type Domain = "TRADING" | "FINANCE" | "SENTRYOPS" | "LIFE";

type GoalItem = {
  name: string;
  status: string;
  detail: string;
  progress: number | null;
  active?: boolean;
};

function percentLabel(value: number) {
  if (value > 0 && value < 0.01) return "<0.01%";
  return `${Math.round(value * 10) / 10}%`;
}

function tone(goal: GoalItem) {
  if (goal.status === "DONE" || goal.status === "GREEN") return "goal-good";
  if (goal.active || goal.status === "ACTIVE" || goal.status === "YELLOW") return "goal-watch";
  return "goal-risk";
}

function hasEvent(events: RuntimeEvent[], type: string) {
  return events.some((event) => event.type === type);
}

export default function DomainGoals({ domain, events }: { domain: Domain; events: RuntimeEvent[] }) {
  const [finance, setFinance] = useState<FinanceRuntimeState | null>(null);
  const [bibleDone, setBibleDone] = useState(false);

  useEffect(() => {
    if (domain !== "FINANCE") return;
    let cancelled = false;
    async function refresh() {
      try {
        const response = await fetch("/api/finance/state", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { state?: FinanceRuntimeState };
        if (!cancelled && body.state) setFinance(body.state);
      } catch {
        // Keep last known state.
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [domain]);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    setBibleDone(window.localStorage.getItem("jarvis-life-bible-date") === today);
  }, []);

  const goals = useMemo<GoalItem[]>(() => {
    if (domain === "TRADING") {
      const passed = hasEvent(events, "trading.account_passed");
      const payout = hasEvent(events, "trading.payout_received");
      return [
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
      return [
        { name: "READ BIBLE TODAY", status: bibleDone ? "DONE" : "ACTIVE", detail: bibleDone ? "Completed today." : "Manual check-off because there is no reliable external data source.", progress: bibleDone ? 100 : 0, active: !bibleDone },
        { name: "MOVE OUT READINESS", status: "LINKED TO FINANCE", detail: "Moves only when Finance gates are actually satisfied.", progress: null },
        { name: "LIFESTYLE UPGRADE", status: "LINKED TO FINANCE", detail: "Lifestyle expands after cash flow, debt, credit and reserves support it.", progress: null },
      ];
    }

    const metrics = finance?.metrics;
    if (!metrics) {
      return [
        { name: "FINANCE STATE", status: "LOADING", detail: "Reading the latest Finance runtime state.", progress: null, active: true },
      ];
    }

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
  }, [bibleDone, domain, events, finance]);

  function toggleBible() {
    const today = new Date().toISOString().slice(0, 10);
    if (bibleDone) {
      window.localStorage.removeItem("jarvis-life-bible-date");
      setBibleDone(false);
    } else {
      window.localStorage.setItem("jarvis-life-bible-date", today);
      setBibleDone(true);
    }
  }

  return (
    <div className="goal-list">
      {goals.map((goal) => (
        <div className={`goal ${tone(goal)}`} key={goal.name}>
          <div className="goal-head">
            <span>{goal.name}</span>
            <b>{goal.progress == null ? goal.status : percentLabel(goal.progress)}</b>
          </div>
          {goal.progress != null && <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, goal.progress))}%` }} /></div>}
          <div className="tiny-row"><span>{goal.detail}</span>{domain === "LIFE" && goal.name === "READ BIBLE TODAY" ? <input aria-label="Mark Bible reading complete" type="checkbox" checked={bibleDone} onChange={toggleBible} /> : null}</div>
        </div>
      ))}
    </div>
  );
}
