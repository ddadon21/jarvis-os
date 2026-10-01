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
const CODING_HISTORY_KEY = "jarvis-coding-history-v1";

type CoreState = {
  activeDomain?: string;
  nextMove?: { title?: string; reason?: string; domain?: string };
  memories?: Array<{ domain?: string; fact?: string }>;
};

type SystemStatus = {
  core?: {
    generatedAt?: string;
    identity?: { name?: string; owner?: string; role?: string };
    worldState?: { asOf?: string; mission?: string };
    permissions?: {
      defaultPosture?: string;
      autoProceed?: string[];
      askDwightFirst?: string[];
      hardLimits?: string[];
    };
    tools?: Array<{
      id?: string;
      label?: string;
      state?: string;
      authority?: string;
      capabilities?: string[];
      note?: string;
    }>;
    memory?: {
      decisions?: Array<{
        id?: string;
        at?: string;
        decision?: string;
        reason?: string;
        expectedOutcome?: string;
        evidence?: string[];
        source?: string;
      }>;
      objectives?: Array<{
        id?: string;
        title?: string;
        domain?: string;
        status?: string;
        currentFocus?: string;
        successDefinition?: string;
      }>;
    };
  };
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
  integrations?: {
    sentryopsResearch?: string;
    calendar?: string;
    email?: string;
    meetings?: string;
    contacts?: string;
    webSearch?: string;
  };
};

type AssistantState = {
  updatedAt?: string;
  sources?: {
    calendar?: string;
    email?: string;
    meetings?: string;
    contacts?: string;
    webSearch?: string;
  };
  calendar?: {
    asOf?: string | null;
    events?: Array<{
      id?: string;
      title?: string;
      startAt?: string;
      endAt?: string | null;
      status?: string;
      location?: string | null;
      joinUrl?: string | null;
      organizer?: string | null;
      attendees?: Array<{ name?: string | null; email?: string | null; response?: string | null }>;
      source?: string;
      updatedAt?: string;
    }>;
  };
  communications?: {
    asOf?: string | null;
    recent?: Array<{
      id?: string;
      channel?: string;
      from?: string | null;
      subject?: string | null;
      summary?: string;
      receivedAt?: string;
      source?: string;
    }>;
  };
};

type CodingResult = {
  id?: string;
  provider?: string;
  workspace?: string | null;
  task?: string;
  ok?: boolean;
  summary?: string;
  evidence?: string[];
  error?: string | null;
  completedAt?: string;
  outputExcerpt?: string | null;
};

function filePart(value: string | null | undefined, fallback = "item") {
  const safe = String(value || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
  return safe || fallback;
}

function isoDay(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "undated";
  return new Date(value).toISOString().slice(0, 10);
}

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

function decisionLogNote(status: SystemStatus) {
  const decisions = status.core?.memory?.decisions ?? [];
  const lines = [
    "---", "domain: decisions", "type: institutional-log", "---", "",
    "# JARVIS Decision Log", "",
    "> Durable decision memory. Decisions are preserved with reason, expected outcome, and evidence rather than reduced to the latest next move.", ""
  ];
  if (!decisions.length) lines.push("_No durable Core decisions are recorded yet._");
  for (const decision of decisions) {
    lines.push(
      "## " + (decision.decision || "Decision"),
      "- **At:** " + when(decision.at),
      "- **Reason:** " + (decision.reason || "Not recorded"),
      "- **Expected outcome:** " + (decision.expectedOutcome || "Not recorded"),
      "- **Source:** " + (decision.source || "JARVIS Core"),
    );
    if (decision.evidence?.length) {
      lines.push("- **Evidence:**");
      for (const evidence of decision.evidence.slice(0, 12)) lines.push("  - " + evidence);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function decisionHistoryNote(item: {
  id?: string;
  at?: string;
  decision?: string;
  reason?: string;
  expectedOutcome?: string;
  evidence?: string[];
  source?: string;
}) {
  const lines = [
    "---",
    "domain: decisions",
    "type: decision",
    "decision_id: " + (item.id || "unknown"),
    "date: " + isoDay(item.at),
    "---", "",
    "# " + (item.decision || "Decision"), "",
    "- **At:** " + when(item.at),
    "- **Reason:** " + (item.reason || "Not recorded"),
    "- **Expected outcome:** " + (item.expectedOutcome || "Not recorded"),
    "- **Source:** " + (item.source || "JARVIS Core"),
    "", "## Evidence",
  ];
  if (!item.evidence?.length) lines.push("_No evidence attached._");
  for (const evidence of item.evidence || []) lines.push("- " + evidence);
  return lines.join("\n");
}

function projectsNote(status: SystemStatus) {
  const objectives = status.core?.memory?.objectives ?? [];
  const lines = [
    "---", "domain: projects", "type: active-projects", "---", "",
    "# Active Projects & Objectives", "",
    "- **Mission:** " + (status.core?.worldState?.mission || status.workforce?.executiveSummary || "Not recorded"),
    "- **As of:** " + when(status.core?.worldState?.asOf || status.core?.generatedAt), "",
  ];
  if (!objectives.length) lines.push("_No Core objectives are currently recorded._");
  for (const objective of objectives) {
    lines.push(
      "## " + (objective.title || "Untitled objective"),
      "- **Domain:** " + (objective.domain || "CORE"),
      "- **Status:** " + (objective.status || "UNKNOWN"),
      "- **Current focus:** " + (objective.currentFocus || "Not recorded"),
      "- **Definition of done:** " + (objective.successDefinition || "Not recorded"),
      "",
    );
  }
  return lines.join("\n");
}

function systemCapabilityNote(status: SystemStatus) {
  const core = status.core;
  const tools = core?.tools ?? [];
  const permissions = core?.permissions;
  const lines = [
    "---", "domain: system", "type: capability-registry", "---", "",
    "# JARVIS Capability Registry", "",
    "- **Generated:** " + when(core?.generatedAt),
    "- **Operating posture:** " + (permissions?.defaultPosture || "Unknown"), "",
    "## Tools",
  ];
  if (!tools.length) lines.push("_No Core tool registry available._");
  for (const tool of tools) {
    lines.push(
      "### " + (tool.label || tool.id || "Tool"),
      "- **State:** " + (tool.state || "UNKNOWN"),
      "- **Authority:** " + (tool.authority || "UNKNOWN"),
      "- **Capabilities:** " + (tool.capabilities?.join(" · ") || "None recorded"),
      "- **Note:** " + (tool.note || "None"),
      "",
    );
  }
  lines.push("## Permission Boundaries");
  lines.push("### Auto-proceed");
  for (const item of permissions?.autoProceed ?? []) lines.push("- " + item);
  lines.push("", "### Ask Dwight first");
  for (const item of permissions?.askDwightFirst ?? []) lines.push("- " + item);
  lines.push("", "### Hard limits");
  for (const item of permissions?.hardLimits ?? []) lines.push("- " + item);
  return lines.join("\n");
}

function meetingsNote(assistant: AssistantState | null) {
  const events = [...(assistant?.calendar?.events ?? [])]
    .filter(event => event.status !== "CANCELLED" && event.startAt && Number.isFinite(Date.parse(event.startAt)))
    .sort((a, b) => Date.parse(a.startAt || "") - Date.parse(b.startAt || ""))
    .slice(0, 30);
  const lines = [
    "---", "domain: meetings", "type: upcoming", "---", "",
    "# Upcoming Meetings", "",
    "- **Calendar source:** " + (assistant?.sources?.calendar || "NOT CONNECTED"),
    "- **As of:** " + when(assistant?.calendar?.asOf || assistant?.updatedAt), "",
  ];
  if (!events.length) lines.push("_No upcoming connected-calendar events are available._");
  for (const event of events) {
    lines.push(
      "## " + (event.title || "Untitled event"),
      "- **Start:** " + when(event.startAt),
      "- **End:** " + when(event.endAt),
      "- **Status:** " + (event.status || "UNKNOWN"),
      "- **Organizer:** " + (event.organizer || "Not recorded"),
      "- **Location:** " + (event.location || "Not recorded"),
    );
    if (event.attendees?.length) {
      lines.push("- **Attendees:** " + event.attendees.slice(0, 20).map(person => person.name || person.email || "Unknown").join(" · "));
    }
    if (event.joinUrl) lines.push("- **Join:** " + event.joinUrl);
    lines.push("");
  }
  return lines.join("\n");
}

function peopleNote(assistant: AssistantState | null) {
  const people = new Map<string, { name: string; email: string | null; context: Set<string>; lastSeen: string | null }>();

  for (const event of assistant?.calendar?.events ?? []) {
    for (const attendee of event.attendees ?? []) {
      const email = attendee.email?.trim() || null;
      const name = attendee.name?.trim() || email || "Unknown";
      const key = (email || name).toLowerCase();
      if (!key || key === "unknown") continue;
      const current = people.get(key) ?? { name, email, context: new Set<string>(), lastSeen: null };
      if (event.title) current.context.add("Meeting: " + event.title);
      if (event.startAt && (!current.lastSeen || Date.parse(event.startAt) > Date.parse(current.lastSeen))) current.lastSeen = event.startAt;
      people.set(key, current);
    }
  }

  for (const signal of assistant?.communications?.recent ?? []) {
    const raw = signal.from?.trim();
    if (!raw) continue;
    const emailMatch = raw.match(/<([^>]+@[^>]+)>/) || raw.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
    const email = emailMatch?.[1] || null;
    const name = raw.replace(/<[^>]+>/g, "").replace(/^["']|["']$/g, "").trim() || email || raw;
    const key = (email || name).toLowerCase();
    const current = people.get(key) ?? { name, email, context: new Set<string>(), lastSeen: null };
    if (signal.subject) current.context.add("Email: " + signal.subject);
    if (signal.receivedAt && (!current.lastSeen || Date.parse(signal.receivedAt) > Date.parse(current.lastSeen))) current.lastSeen = signal.receivedAt;
    people.set(key, current);
  }

  const ordered = [...people.values()]
    .sort((a, b) => Date.parse(b.lastSeen || "1970-01-01") - Date.parse(a.lastSeen || "1970-01-01"))
    .slice(0, 30);

  const lines = [
    "---", "domain: people", "type: relationship-context", "---", "",
    "# Recent People & Relationship Context", "",
    "> Built only from connected meeting attendees and recent communication metadata. It is context, not a CRM judgment.", "",
  ];
  if (!ordered.length) lines.push("_No connected people context is available yet._");
  for (const person of ordered) {
    lines.push(
      "## " + person.name,
      "- **Email:** " + (person.email || "Not recorded"),
      "- **Last seen in connected context:** " + when(person.lastSeen),
      "- **Recent context:** " + ([...person.context].slice(0, 6).join(" · ") || "Not recorded"),
      "",
    );
  }
  return lines.join("\n");
}

function communicationsNote(assistant: AssistantState | null) {
  const recent = [...(assistant?.communications?.recent ?? [])]
    .filter(item => item.receivedAt && Number.isFinite(Date.parse(item.receivedAt)))
    .sort((a, b) => Date.parse(b.receivedAt || "1970-01-01") - Date.parse(a.receivedAt || "1970-01-01"))
    .slice(0, 40);

  const lines = [
    "---", "domain: communications", "type: recent-email-signals", "---", "",
    "# Recent Email Signals", "",
    "- **Email source:** " + (assistant?.sources?.email || "NOT CONNECTED"),
    "- **As of:** " + when(assistant?.communications?.asOf || assistant?.updatedAt), "",
    "> This is a compact institutional index of recent connected email context. It does not mirror full message bodies unless a future workflow explicitly requires that.", "",
  ];

  if (!recent.length) lines.push("_No recent connected email signals are available._");
  for (const item of recent) {
    lines.push(
      "## " + (item.subject || "No subject"),
      "- **From:** " + (item.from || "Unknown sender"),
      "- **Received:** " + when(item.receivedAt),
      "- **Channel:** " + (item.channel || "EMAIL"),
      "- **Summary:** " + (item.summary || "No summary available"),
      "- **Source:** " + (item.source || "Connected email"),
      "",
    );
  }

  return lines.join("\n");
}

function codingIndexNote(history: CodingResult[]) {
  const recent = [...history]
    .sort((a, b) => Date.parse(b.completedAt || "1970-01-01") - Date.parse(a.completedAt || "1970-01-01"))
    .slice(0, 30);
  const lines = [
    "---", "domain: coding", "type: executor-index", "---", "",
    "# Coding Executor Outcomes", "",
    "> This keeps outcome-level history from approved Codex/Claude Code jobs. Full noisy terminal output is intentionally not mirrored.", "",
  ];
  if (!recent.length) lines.push("_No coding executor jobs have completed through JARVIS yet._");
  for (const item of recent) {
    lines.push(
      "- " + when(item.completedAt) +
      " · **" + (item.provider || "CODING AGENT") + "**" +
      " · " + (item.ok ? "VERIFIED COMPLETE" : "FAILED") +
      " · " + (item.task || item.summary || "Untitled coding task"),
    );
  }
  return lines.join("\n");
}

function codingHistoryNote(item: CodingResult) {
  const lines = [
    "---",
    "domain: coding",
    "type: executor-result",
    "executor_id: " + (item.id || "unknown"),
    "provider: " + (item.provider || "unknown"),
    "date: " + isoDay(item.completedAt),
    "verified: " + (item.ok ? "true" : "false"),
    "---", "",
    "# " + (item.provider || "Coding Agent") + " — " + (item.task || "Coding Task"), "",
    "- **Completed:** " + when(item.completedAt),
    "- **Result:** " + (item.ok ? "SUCCESS" : "FAILED"),
    "- **Workspace:** " + (item.workspace || "Default approved workspace"),
    "- **Summary:** " + (item.summary || "No summary recorded"),
  ];
  if (item.error) lines.push("- **Error:** " + item.error);
  if (item.evidence?.length) {
    lines.push("", "## Evidence");
    for (const evidence of item.evidence.slice(0, 16)) lines.push("- " + evidence);
  }
  if (item.outputExcerpt) {
    lines.push("", "## Result Excerpt", item.outputExcerpt.slice(0, 1800));
  }
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
    "- [[06 Decisions/Decision Log|Decision Log]]",
    "- [[08 Research/SentryOps Research Pulse|Research]]",
    "- [[09 Projects/Active Projects|Projects]]",
    "- [[10 System/JARVIS Capability Registry|System / Capabilities]]",
    "- [[11 Meetings/Upcoming Meetings|Meetings]]",
    "- [[12 People/Recent Contacts|People]]",
    "- [[13 Coding/Executor Outcomes|Coding Outcomes]]",
    "- [[14 Communications/Recent Email Signals|Communications]]", "",
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
    "- [[06 Decisions/Current Next Move|Current Next Move]]",
    "- [[06 Decisions/Decision Log|Decision Log]]",
    "- [[09 Projects/Active Projects|Projects]]",
    "- [[10 System/JARVIS Capability Registry|System]]",
    "- [[11 Meetings/Upcoming Meetings|Meetings]]",
    "- [[13 Coding/Executor Outcomes|Coding Outcomes]]",
    "- [[14 Communications/Recent Email Signals|Communications]]", "",
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

async function assistantState() {
  try {
    const response = await fetch("/api/assistant/state", { cache: "no-store" });
    if (!response.ok) return null;
    const body = await response.json() as { state?: AssistantState };
    return body.state ?? null;
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
        const codingHistory = readJson<CodingResult[]>(CODING_HISTORY_KEY, []);
        const [finance, system, assistant] = await Promise.all([financeState(), systemState(), assistantState()]);
        const notes: Array<{ path: string; content: string }> = [
          { path: "00 Inbox/JARVIS Knowledge Map.md", content: knowledgeMap(dayKey) },
          { path: "01 Daily/" + dayKey + ".md", content: dailyNote(dayKey, core) },
          { path: "04 Life/Daily/" + dayKey + ".md", content: lifeNote(dayKey) },
          { path: "04 Life/Weekly/7D Review - " + dayKey + ".md", content: weeklyLifeNote(dayKey) },
          { path: "07 Faith/Daily/" + dayKey + ".md", content: faithNote(dayKey) },
          { path: "03 Finance/Next Payout Plan.md", content: payoutPlanNote(plan) },
          { path: "06 Decisions/Current Next Move.md", content: nextMoveNote(core) },
          { path: "11 Meetings/Upcoming Meetings.md", content: meetingsNote(assistant) },
          { path: "12 People/Recent Contacts.md", content: peopleNote(assistant) },
          { path: "13 Coding/Executor Outcomes.md", content: codingIndexNote(codingHistory) },
          { path: "14 Communications/Recent Email Signals.md", content: communicationsNote(assistant) },
        ];
        if (finance) notes.push({ path: "03 Finance/Current Capital Snapshot.md", content: financeNote(finance) });
        if (system) {
          notes.push({ path: "05 SentryOps/Current Operating State.md", content: sentryNote(system) });
          notes.push({ path: "08 Research/SentryOps Research Pulse.md", content: researchNote(system) });
          notes.push({ path: "06 Decisions/Decision Log.md", content: decisionLogNote(system) });
          notes.push({ path: "09 Projects/Active Projects.md", content: projectsNote(system) });
          notes.push({ path: "10 System/JARVIS Capability Registry.md", content: systemCapabilityNote(system) });

          for (const decision of system.core?.memory?.decisions ?? []) {
            if (!decision.id) continue;
            notes.push({
              path: "06 Decisions/History/" + isoDay(decision.at) + " - " + filePart(decision.id, "decision") + ".md",
              content: decisionHistoryNote(decision),
            });
          }
        }
        for (const item of codingHistory.slice(-40)) {
          if (!item.id) continue;
          notes.push({
            path: "13 Coding/History/" + isoDay(item.completedAt) + " - " + filePart(item.provider, "agent") + " - " + filePart(item.id, "run") + ".md",
            content: codingHistoryNote(item),
          });
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
    const onCoding = () => void sync("coding outcome");
    const onGoogle = () => void sync("workspace updated");
    const onManual = () => void sync("manual");
    const onFocus = () => void sync("window focused");
    const onStorage = (event: StorageEvent) => {
      if (!event.key || [LIFE_PLAN_KEY, CORE_KEY, FINANCE_PLAN_KEY, CODING_HISTORY_KEY].includes(event.key)) void sync("state changed");
    };

    window.addEventListener("jarvis-life-updated", onLife);
    window.addEventListener("jarvis-state-updated", onCore);
    window.addEventListener("jarvis-coding-result", onCoding);
    window.addEventListener("jarvis-google-sync", onGoogle);
    window.addEventListener("jarvis-obsidian-sync-now", onManual);
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);

    return () => {
      disposed = true;
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener("jarvis-life-updated", onLife);
      window.removeEventListener("jarvis-state-updated", onCore);
      window.removeEventListener("jarvis-coding-result", onCoding);
      window.removeEventListener("jarvis-google-sync", onGoogle);
      window.removeEventListener("jarvis-obsidian-sync-now", onManual);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return null;
}
