import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { getTradingState } from "./trading-runtime";
import { listStoredTrades } from "./trading-store";
import { tradeStats } from "./trading-analytics";
import { barCoverage, listModelRuns } from "./learning/store.ts";
import { recallMemory, searchVault } from "./jarvis-memory";
import { addWorkforceTask, getOrSeedWorkforceState } from "./jarvis-workforce";
import type { AgentId } from "./jarvis-runtime";

function compact(value: unknown, max = 5000) {
  const text = JSON.stringify(value);
  return text.length > max ? text.slice(0, max) + "…(truncated)" : text;
}

const AGENTS = ["EXECUTIVE", "FINANCE_CFO", "SENTRYOPS_RESEARCH", "TRADING_OBSERVER", "BUILDER", "JARVIS_QA", "IT_INFRA", "IT_SECURITY", "IT_INTEGRATIONS"] as const;

/** Tools Jarvis chat can call. Read-only except assign_task, which is Dwight's own request. */
export function jarvisChatTools(): ToolSet {
  return {
    get_trading_state: tool({
      description: "Live Trading Observer read: current position/order, today's trades, rule usage.",
      inputSchema: z.object({}),
      execute: async () => {
        const s = await getTradingState();
        return compact({ connection: s.account.connection, observer: s.observer, today: s.today, guardrails: s.guardrails });
      },
    }),
    get_trade_statistics: tool({
      description: "Statistics over Dwight's journaled trades (win rate, R, excursions, give-back, by hour and side).",
      inputSchema: z.object({ sinceDays: z.number().int().min(1).max(730).optional() }),
      execute: async ({ sinceDays }) => {
        const since = sinceDays ? new Date(Date.now() - sinceDays * 86_400_000).toISOString() : undefined;
        const trades = await listStoredTrades({ since, limit: 5000 });
        return trades ? compact(tradeStats(trades as never)) : "Durable trade storage is not configured.";
      },
    }),
    get_recent_trades: tool({
      description: "Most recent journaled trades with entry, exit, stops, P&L.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(30).optional() }),
      execute: async ({ limit }) => compact((await listStoredTrades({ limit: limit ?? 10 })) ?? "Durable trade storage is not configured."),
    }),
    get_learning_status: tool({
      description: "DEVIANT learning pipeline: bar coverage and latest model runs vs DEVIANT v1 and Dwight.",
      inputSchema: z.object({}),
      execute: async () => {
        const [coverage, runs] = await Promise.all([barCoverage(), listModelRuns(3)]);
        return compact({ coverage, runs: runs.map((r) => ({ id: r.id, status: r.status, outcome: r.report.status, message: r.report.message, test: r.report.metrics.test?.combined, baseline: r.report.metrics.baselineTest?.combined, verdict: r.report.verdict })) });
      },
    }),
    search_memory: tool({
      description: "Search Jarvis's long-term memory of durable facts about Dwight, his rules, goals and decisions.",
      inputSchema: z.object({ query: z.string().min(2).max(200) }),
      execute: async ({ query }) => compact(await recallMemory(query, 15)),
    }),
    search_notes: tool({
      description: "Search Dwight's Obsidian vault notes indexed by the Local Agent.",
      inputSchema: z.object({ query: z.string().min(2).max(200) }),
      execute: async ({ query }) => {
        const notes = await searchVault(query);
        return notes.length ? compact(notes) : "No indexed vault notes matched (or the vault is not indexed yet).";
      },
    }),
    list_workforce_tasks: tool({
      description: "Open and recent agent tasks with status and results.",
      inputSchema: z.object({}),
      execute: async () => {
        const state = await getOrSeedWorkforceState();
        return compact((state.tasks ?? []).filter((t) => t.source !== "workforce.cycle").slice(0, 15).map((t) => ({ title: t.title, agent: t.assignedTo, status: t.status, result: t.result?.slice(0, 300), proof: t.verification?.state })));
      },
    }),
    assign_task: tool({
      description: "Assign work to an agent because Dwight asked for it in this conversation. Governance still applies.",
      inputSchema: z.object({ title: z.string().min(8).max(200), assignedTo: z.enum(AGENTS) }),
      execute: async ({ title, assignedTo }) => {
        const task = await addWorkforceTask({ title, assignedTo: assignedTo as AgentId, priority: "HIGH", source: "jarvis.chat" });
        return `Assigned to ${task.assignedTo}: status ${task.status}${task.status === "WAITING_APPROVAL" ? " (waiting for Dwight's approval on the agents floor)" : " (runs on the next workforce cycle, or Run now on the floor)"}.`;
      },
    }),
  };
}
