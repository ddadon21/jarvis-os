"use client";

import { useEffect, useRef } from "react";
import { DAY_BLOCKS, LIFE_PLAN_KEY, REFLECTIONS, loadLifePlan, localDay, newLifeDay, reflectionIndex } from "../lib/life-plan";
import { PILLARS } from "../lib/life-missions";
import type { FinanceRuntimeState } from "../lib/jarvis-runtime";
import type { PayoutPlan } from "../lib/finance-math";
import { writeObsidianNote } from "../lib/obsidian-bridge-client";

const CORE_KEY = "jarvis-os-state-v1";
const FINANCE_PLAN_KEY = "jarvis-finance-payout-plan-v1";
const FP_KEY = "jarvis-obsidian-sync-fingerprints-v1";

type CoreState = {
  activeDomain?: string;
  nextMove?: { title?: string; reason?: string; domain?: string };
  memories?: Array<{ domain?: string; fact?: string }>;
};

type SystemStatus = {
  workforce?: {
    status?: string;
    lastCycleAt?: string | null;
    executiveSummary?: string;
    agents?: Array<{ id?: string; status?: string; permissionCeiling?: string; currentWork?: string; lastResult?: string }>;
    objectives?: Array<{ title?: string; status?: string; currentFocus?: string; successDefinition?: string }>;
  };
  backgroundResearch?: {
    latestPulse?: {
      ranAt?: string;
      status?: string;
      summary?: string;
      opportunities?: Array<{ title?: string; priority?: string; whyItMatters?: string; evidence?: string }>;
    } | null;
  };
  events?: Array<{ domain?: string; importance?: string; occurredAt?: string; summary?: string }>;
  integrations?: { sentryopsResearch?: string };
};

function hashText(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function money(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "Unknown";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function when(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not available";
  return new Date(value).toLocaleString();
}

function lifeNote(dayKey: string) {
  const plan = loadLifePlan();
  const day = plan.days[dayKey] || newLifeDay();
  const missions = plan.missions.filter(m => m.date === dayKey);
  const intelligence = REFLECTIONS[day.intelligenceIndex ?? (reflectionIndex(dayKey) % REFLECTIONS.length)];
  const lines = [
    "---", "date: " + dayKey, "domain: life", "---", "",
    "# Life - " + dayKey, "",
    "## Daily Intelligence",
    "- **Thought:** " + intelligence[0],
    "- **Action:** " + intelligence[1],
    "- **Scripture:** " + intelligence[2], "",
    "## Priorities"
  ];
  for (const item of day.priorities) lines.push("- [" + (item.done ? "x" : " ") + "] " + item.title);
  lines.push("", "## Foundations");
  for (const block of DAY_BLOCKS) lines.push("- [" + (day.blocks[block.id] ? "x" : " ") + "] **" + block.label + "** - " + block.action);
  lines.push("", "## Focus", "- **Focused minutes:** " + day.focusMinutes, "", "## Missions");
  if (!missions.length) lines.push("_No missions scheduled._");
  for (const mission of missions) {
    const label = PILLARS.find(p => p.id === mission.pillar)?.label || mission.pillar;
    lines.push("- [" + (mission.done ? "x" : " ") + "] **" + mission.title + "** - " + label + " - " + (mission.time || "Flexible") + " - " + mission.minutes + " min");
    if (mission.evidence?.trim()) lines.push("  - Result / lesson: " + mission.evidence.trim());
  }
  lines.push("", "## Close the Day",
    "- **Win:** " + (day.win.trim() || "_Not recorded yet._"),
    "- **Lesson:** " + (day.lesson.trim() || "_Not recorded yet._"),
    "- **Tomorrow:** " + (day.tomorrow.trim() || "_Not recorded yet._"),
    "", "> Source: JARVIS Life. Supabase remains the structured source of truth.", "");
  return lines.join("\n");
}

function faithNote(dayKey: string) {
  const plan = loadLifePlan();
  const day = plan.days[dayKey] || newLifeDay();
  const intelligence = REFLECTIONS[day.intelligenceIndex ?? (reflectionIndex(dayKey) % REFLECTIONS.length)];
  const missions = plan.missions.filter(m => m.date === dayKey && m.pillar === "faith");
  const lines = [
    "---", "date: " + dayKey, "domain: faith", "---", "",
    "# Faith - " + dayKey, "",
    "## Daily Intelligence",
    "- **Scripture:** " + intelligence[2],
    "- **Thought:** " + intelligence[0],
    "- **Practice:** " + intelligence[1], "",
    "## Start With God",
    "- [" + (day.blocks.faith ? "x" : " ") + "] Read Scripture, pray, and choose one way to live it today.", "",
    "## Faith Missions"
  ];
  if (!missions.length) lines.push("_No separate faith mission scheduled today._");
  for (const mission of missions) {
    lines.push("- [" + (mission.done ? "x" : " ") + "] **" + mission.title + "**");
    if (mission.evidence?.trim()) lines.push("  - Reflection / evidence: " + mission.evidence.trim());
  }
  lines.push("", "> JARVIS mirrors what you record; it does not invent spiritual reflections for you.", "");
  return lines.join("\n");
}

function weeklyLifeNote(dayKey: string) {
  const plan = loadLifePlan();
  const end = new Date(dayKey + "T12:00:00");
  const dates: string[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    dates.push(localDay(d));
  }
  const completed = plan.missions.filter(m => m.done && dates.includes(m.completedOn || m.date));
  const lines = ["---", "week_ending: " + dayKey, "domain: life", "---", "", "# Life 7-Day Review - " + dayKey, "", "## Development"];
  for (const pillar of PILLARS) {
    lines.push("- **" + pillar.label + ":** " + completed.filter(m => m.pillar === pillar.id).length + "/" + pillar.target);
  }
  lines.push("", "## Completed Missions");
  if (!completed.length) lines.push("_No completed missions recorded in this 7-day window._");
  for (const mission of completed) lines.push("- " + (mission.completedOn || mission.date) + " - **" + mission.title + "**");
  lines.push("", "## Wins / Lessons");
  for (const date of dates) {
    const day = plan.days[date];
    if (!day || (!day.win.trim() && !day.lesson.trim())) continue;
    lines.push("### " + date, "- Win: " + (day.win.trim() || "_Not recorded._"), "- Lesson: " + (day.lesson.trim() || "_Not recorded._"));
  }
  return lines.join("\n");
}

function financeNote(state: FinanceRuntimeState) {
  const lines = [
    "---", "domain: finance", "as_of: " + state.asOf, "mode: " + state.mode, "---", "",
    "# Finance - Current Capital Snapshot", "",
    "> Snapshot as of **" + when(state.asOf) + "** from **" + state.source + "**. This is a recorded snapshot, not a claim that every institution is real-time.", "",
    "## Capital",
    "- **Personal net worth:** " + money(state.metrics.personalNetWorth),
    "- **Liquidity:** " + money(state.metrics.liquidity),
    "- **Investment value:** " + money(state.metrics.investmentValue),
    "- **Personal debt:** " + money(state.metrics.personalDebt),
    "- **Current stage:** " + state.currentStage,
    "- **Next stage:** " + state.nextStage, "",
    "## Accounts"
  ];
  for (const account of state.accounts) {
    lines.push("- **" + account.institution + " - " + account.name + "** - " + account.ownership + " - " + account.role + " - current " + money(account.current) + (account.available == null ? "" : " - available " + money(account.available)));
  }
  lines.push("", "## Goals");
  for (const goal of state.goals) lines.push("- **" + goal.name + "** - " + goal.state + " - " + goal.current + " -> " + goal.target + (goal.blocker ? " - blocker: " + goal.blocker : ""));
  lines.push("", "## Data Note", state.note || "_No additional data note._", "", "> JARVIS Finance / Supabase remains the numerical source of truth.", "");
  return lines.join("\n");
}

function payoutPlanNote(plan: PayoutPlan | null) {
  if (!plan) return "# Finance - Next Payout Plan\n\n_No payout plan has been saved in JARVIS yet._\n";
  return [
    "# Finance - Next Payout Plan", "",
    "- **Net payout:** " + (plan.payout || "_Not set_"),
    "- **Tax reserve:** " + (plan.tax || "_Not set_"),
    "- **Bills + minimums:** " + (plan.bills || "_Not set_"),
    "- **Cash reserve:** " + (plan.reserve || "_Not set_"),
    "- **Extra debt payment:** " + (plan.debt || "_Not set_"),
    "- **Business capital:** " + (plan.business || "_Not set_"),
    "- **Debt target:** " + (plan.target || "_Not set_"), "",
    "> Planning note only. Saving this in JARVIS does not move money.", ""
  ].join("\n");
}

function sentryNote(status: SystemStatus) {
  const w = status.workforce;
  const pulse = status.backgroundResearch?.latestPulse;
  const lines = [
    "---", "domain: sentryops", "---", "",
    "# SentryOps - Current Operating State", "",
    "## Executive State",
    "- **Workforce:** " + (w?.status || "Unknown"),
    "- **Last cycle:** " + when(w?.lastCycleAt),
    "- **Research integration:** " + (status.integrations?.sentryopsResearch || "Unknown"), "",
    w?.executiveSummary || "_No executive summary yet._", "",
    "## Active Objectives"
  ];
  if (!w?.objectives?.length) lines.push("_No active objectives recorded._");
  for (const objective of w?.objectives || []) lines.push("- **" + (objective.title || "Untitled") + "** - " + (objective.status || "UNKNOWN") + " - " + (objective.currentFocus || objective.successDefinition || "No focus recorded."));
  lines.push("", "## AI Workforce");
  if (!w?.agents?.length) lines.push("_No agent state recorded._");
  for (const agent of w?.agents || []) lines.push("- **" + (agent.id || "AGENT") + "** - " + (agent.status || "UNKNOWN") + " - " + (agent.permissionCeiling || "READ") + " - " + (agent.currentWork || agent.lastResult || "Idle"));
  lines.push("", "## Latest Research Pulse", "- **Status:** " + (pulse?.status || "No pulse yet"), "- **Ran:** " + when(pulse?.ranAt), "", pulse?.summary || "_No research summary yet._", "", "## Recent Events");
  const events = (status.events || []).filter(e => e.domain === "SENTRYOPS").slice(0, 12);
  if (!events.length) lines.push("_No recent SentryOps events._");
  for (const event of events) lines.push("- " + when(event.occurredAt) + " - **" + (event.importance || "NORMAL") + "** - " + (event.summary || "Event"));
  return lines.join("\n");
}

function researchNote(status: SystemStatus) {
  const pulse = status.backgroundResearch?.latestPulse;
  const lines = ["---", "domain: research", "topic: sentryops", "---", "", "# SentryOps Research Pulse", "", "- **Last run:** " + when(pulse?.ranAt), "- **Status:** " + (pulse?.status || "No pulse yet"), "", "## Summary", pulse?.summary || "_No research pulse yet._", "", "## Opportunities"];
  if (!pulse?.opportunities?.length) lines.push("_No opportunities recorded._");
  for (const item of pulse?.opportunities || []) lines.push("- **[" + (item.priority || "MEDIUM") + "] " + (item.title || "Opportunity") + "** - " + (item.whyItMatters || "No rationale recorded.") + (item.evidence ? " Evidence: " + item.evidence : ""));
  return lines.join("\n");
}

function nextMoveNote(core: CoreState) {
  const next = core.nextMove;
  const lines = ["---", "domain: decisions", "type: current-next-move", "---", "", "# Current Next Move", "", "- **Domain:** " + (next?.domain || core.activeDomain || "CORE"), "- **Move:** " + (next?.title || "Not set"), "- **Why:** " + (next?.reason || "No reason recorded."), "", "## Context"];
  const memories = (core.memories || []).filter(m => m.domain === "CORE").slice(-20);
  if (!memories.length) lines.push("_No CORE decision context recorded yet._");
  for (const memory of memories) if (memory.fact) lines.push("- " + memory.fact);
  lines.push("", "> This is current next-move context, not a permanent human decision.", "");
  return lines.join("\n");
}

function knowledgeMap(dayKey: string) {
  return [
    "# JARVIS Knowledge Map", "",
    "## Today",
    "- [[01 Daily/" + dayKey + "|Daily Command]]",
    "- [[04 Life/Daily/" + dayKey + "|Life]]",
    "- [[07 Faith/Daily/" + dayKey + "|Faith]]", "",
    "## Operating Domains",
    "- [[02 Trading|Trading]]",
    "- [[03 Finance/Current Capital Snapshot|Finance]]",
    "- [[04 Life/Weekly/7D Review - " + dayKey + "|Life 7-Day Review]]",
    "- [[05 SentryOps/Current Operating State|SentryOps]]",
    "- [[06 Decisions/Current Next Move|Decisions / Next Move]]",
    "- [[08 Research/SentryOps Research Pulse|Research]]", "",
    "## Storage Model",
    "- **Supabase:** structured source of truth",
    "- **Obsidian:** readable long-term knowledge and reflection",
    "- **Local Agent:** secure bridge between JARVIS and this vault", "",
    "> JARVIS updates this map automatically.", ""
  ].join("\n");
}

function dailyNote(dayKey: string, core: CoreState) {
  return [
    "---", "date: " + dayKey, "domain: core", "---", "",
    "# JARVIS Daily Command - " + dayKey, "",
    "## Current Next Move",
    "- **" + (core.nextMove?.title || "Not set") + "** - " + (core.nextMove?.reason || "No reason recorded."), "",
    "## Domain Notes",
    "- [[04 Life/Daily/" + dayKey + "|Life]]",
    "- [[07 Faith/Daily/" + dayKey + "|Faith]]",
    "- [[03 Finance/Current Capital Snapshot|Finance]]",
    "- [[05 SentryOps/Current Operating State|SentryOps]]",
    "- [[08 Research/SentryOps Research Pulse|Research]]",
    "- [[06 Decisions/Current Next Move|Current Next Move]]", "",
    "## Trading",
    "Trading reviews are written from the Trading Day Journal into 02 Trading/Daily when a day is saved.", ""
  ].join("\n");
}

async function online() {
  const token = window.localStorage.getItem("jarvis-observer-controller-v1") || "";
  if (!token) return false;
  try {
    const response = await fetch("/api/trading/link/status", { cache: "no-store", headers: { Authorization: "Bearer " + token } });
    if (!response.ok) return false;
    const body = await response.json() as { link?: { online?: boolean } };
    return body.link?.online === true;
  } catch {
    return false;
  }
}

async function financeState() {
  try {
    const response = await fetch("/api/finance/state", { cache: "no-store" });
    if (!response.ok) return null;
    const body = await response.json() as { state?: FinanceRuntimeState };
    return body.state || null;
  } catch {
    return null;
  }
}

async function systemState() {
  try {
    const response = await fetch("/api/system/status", { cache: "no-store" });
    if (!response.ok) return null;
    return await response.json() as SystemStatus;
  } catch {
    return null;
  }
}

export default function ObsidianKnowledgeSync() {
  const busy = useRef(false);

  useEffect(() => {
    let disposed = false;

    async function sync(reason: string) {
      if (disposed || busy.current) return;
      busy.current = true;
      let wrote = 0;
      let skipped = 0;
      let failed = 0;

      try {
        if (!(await online())) {
          window.dispatchEvent(new CustomEvent("jarvis-obsidian-sync-status", { detail: { state: "OFFLINE", message: "Knowledge sync is waiting for the Local Agent." } }));
          return;
        }

        window.dispatchEvent(new CustomEvent("jarvis-obsidian-sync-status", { detail: { state: "SYNCING", message: "Syncing knowledge to Obsidian - " + reason } }));

        const dayKey = localDay();
        const core = readJson<CoreState>(CORE_KEY, {});
        const plan = readJson<PayoutPlan | null>(FINANCE_PLAN_KEY, null);
        const [finance, system] = await Promise.all([financeState(), systemState()]);
        const notes: Array<{ path: string; content: string }> = [
          { path: "00 Inbox/JARVIS Knowledge Map.md", content: knowledgeMap(dayKey) },
          { path: "01 Daily/" + dayKey + ".md", content: dailyNote(dayKey, core) },
          { path: "04 Life/Daily/" + dayKey + ".md", content: lifeNote(dayKey) },
          { path: "04 Life/Weekly/7D Review - " + dayKey + ".md", content: weeklyLifeNote(dayKey) },
          { path: "07 Faith/Daily/" + dayKey + ".md", content: faithNote(dayKey) },
          { path: "03 Finance/Next Payout Plan.md", content: payoutPlanNote(plan) },
          { path: "06 Decisions/Current Next Move.md", content: nextMoveNote(core) }
        ];
        if (finance) notes.push({ path: "03 Finance/Current Capital Snapshot.md", content: financeNote(finance) });
        if (system) {
          notes.push({ path: "05 SentryOps/Current Operating State.md", content: sentryNote(system) });
          notes.push({ path: "08 Research/SentryOps Research Pulse.md", content: researchNote(system) });
        }

        const fingerprints = readJson<Record<string, string>>(FP_KEY, {});
        const next = { ...fingerprints };

        for (const note of notes) {
          if (disposed) break;
          const fingerprint = hashText(note.content);
          if (fingerprints[note.path] === fingerprint) {
            skipped += 1;
            continue;
          }
          try {
            await writeObsidianNote(note.path, note.content);
            next[note.path] = fingerprint;
            wrote += 1;
          } catch {
            failed += 1;
          }
        }

        try { window.localStorage.setItem(FP_KEY, JSON.stringify(next)); } catch {}
        window.dispatchEvent(new CustomEvent("jarvis-obsidian-sync-status", {
          detail: {
            state: failed ? "DEGRADED" : "SYNCED",
            message: failed
              ? "Knowledge sync: " + wrote + " updated, " + failed + " failed."
              : "Knowledge synced: " + wrote + " updated, " + skipped + " already current.",
            at: new Date().toISOString()
          }
        }));
      } finally {
        busy.current = false;
      }
    }

    const initial = window.setTimeout(() => void sync("startup"), 3500);
    const timer = window.setInterval(() => void sync("scheduled"), 60000);
    const onLife = () => void sync("life updated");
    const onCore = () => void sync("core updated");
    const onManual = () => void sync("manual");
    const onFocus = () => void sync("window focused");
    const onStorage = (event: StorageEvent) => {
      if (!event.key || [LIFE_PLAN_KEY, CORE_KEY, FINANCE_PLAN_KEY].includes(event.key)) void sync("state changed");
    };

    window.addEventListener("jarvis-life-updated", onLife);
    window.addEventListener("jarvis-state-updated", onCore);
    window.addEventListener("jarvis-obsidian-sync-now", onManual);
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);

    return () => {
      disposed = true;
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener("jarvis-life-updated", onLife);
      window.removeEventListener("jarvis-state-updated", onCore);
      window.removeEventListener("jarvis-obsidian-sync-now", onManual);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return null;
}
