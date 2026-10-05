import { generateText, stepCountIs, tool, type ToolSet } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { agentModel } from "./jarvis-models";
import { getRecentEvents, type AgentState, type AgentTask } from "./jarvis-runtime";
import { getTradingState } from "./trading-runtime";
import { listStoredTrades } from "./trading-store";
import { tradeStats } from "./trading-analytics";
import { getOrSeedFinanceState, financeDirective } from "./finance-live";
import { barCoverage, listModelRuns } from "./learning/store.ts";
import { infrastructureCheck, integrationsCheck, securityCheck } from "./workforce-checks";
import { enqueueApprovedDesktopCommandForPresentDevice, getLocalAgentPresence } from "./trading-device-link";
import { recordApproval } from "./approvals";

/**
 * Tool-using workforce agents. Each agent sees only the tools its permission
 * ceiling allows; results are grounded in tool output and the transcript of
 * tool calls is kept as evidence.
 */

export type AgentRunResult = {
  ok: boolean;
  result: string;
  evidence: string[];
  followups: Array<{ title: string; assignedTo: string; rationale: string }>;
  toolCalls: number;
  model: string | null;
};

const ROLE: Record<string, string> = {
  EXECUTIVE: "You are the Chief of Staff for Himie Johnson Ventures (Dwight's company). Prioritize, synthesize what the other agents found, and decide the single most useful next step.",
  FINANCE_CFO: "You are the CFO agent. Work only from the finance tools. Be precise about what is live versus snapshot data. Never move money or recommend actions you cannot ground in the data.",
  SENTRYOPS_RESEARCH: "You are the SentryOps research agent. Find evidence-backed public-safety software opportunities. Cite sources for every claim. Never invent contracts, vendors or amounts.",
  TRADING_OBSERVER: "You are the Trading agent. You study Dwight's observed trades (no broker API: the Observer journal is the record). Analyze execution: timing, R multiples, excursions, give-back, rule adherence, and what distinguishes his best entries. You never place or suggest live orders.",
  BUILDER: "You are the Builder agent. You turn approved objectives into concrete engineering work for the JARVIS repository and the DEVIANT learning pipeline. You can request a coding run on Dwight's PC only when the task is Dwight-authorized.",
  JARVIS_QA: "You are the QA agent. Verify claims with the check tools. Report only what the checks prove.",
  IT_INFRA: "You are the infrastructure agent. Use the check tools and report concrete fixes.",
  IT_SECURITY: "You are the security agent. Use the check tools and report concrete fixes without revealing secret values.",
  IT_INTEGRATIONS: "You are the integrations agent. Use the check tools and report concrete fixes.",
};

function compact(value: unknown, max = 6000) {
  const text = JSON.stringify(value);
  return text.length > max ? text.slice(0, max) + "…(truncated)" : text;
}

function buildTools(agent: AgentState, task: AgentTask, state: { evidence: string[]; followups: AgentRunResult["followups"] }): ToolSet {
  const tools: ToolSet = {
    get_recent_events: tool({
      description: "Recent JARVIS runtime events (handoffs, trading, research, workforce). Optional domain filter.",
      inputSchema: z.object({ domain: z.enum(["TRADING", "FINANCE", "SENTRYOPS", "LIFE", "CORE"]).optional(), limit: z.number().int().min(1).max(40).optional() }),
      execute: async ({ domain, limit }) => {
        const events = (await getRecentEvents()).filter((e) => !domain || e.domain === domain).slice(0, limit ?? 15);
        return compact(events.map((e) => ({ at: e.occurredAt, type: e.type, summary: e.summary })));
      },
    }),
    record_finding: tool({
      description: "Record one concrete finding with its supporting evidence. Use this for every conclusion you want kept.",
      inputSchema: z.object({ finding: z.string().min(5).max(600), evidence: z.array(z.string().max(300)).max(6) }),
      execute: async ({ finding, evidence }) => {
        state.evidence.push(`finding:${finding}`, ...evidence.map((item) => `source:${item}`));
        return "recorded";
      },
    }),
    propose_task: tool({
      description: "Propose a follow-up task for an agent. It goes through governance (may wait for Dwight's approval).",
      inputSchema: z.object({
        title: z.string().min(8).max(200),
        assignedTo: z.enum(["EXECUTIVE", "FINANCE_CFO", "SENTRYOPS_RESEARCH", "TRADING_OBSERVER", "BUILDER", "JARVIS_QA", "IT_INFRA", "IT_SECURITY", "IT_INTEGRATIONS"]),
        rationale: z.string().max(400),
      }),
      execute: async (input) => {
        if (state.followups.length >= 3) return "limit reached: at most 3 follow-ups per task";
        state.followups.push(input);
        return "queued for governance review";
      },
    }),
  };

  const domain = agent.domain;
  if (domain === "TRADING" || agent.id === "EXECUTIVE" || agent.id === "BUILDER") {
    tools.get_trading_state = tool({
      description: "Live Trading Observer state: current position or order, today's trades, guardrails.",
      inputSchema: z.object({}),
      execute: async () => {
        const s = await getTradingState();
        return compact({ account: { connection: s.account.connection, propFirm: s.account.propFirm }, observer: s.observer, today: s.today, guardrails: s.guardrails });
      },
    });
    tools.get_trade_statistics = tool({
      description: "Statistics over Dwight's journaled trades: win rate, R multiples, best/worst excursion, give-back rate, prep time, by side and by New York hour.",
      inputSchema: z.object({ sinceDays: z.number().int().min(1).max(730).optional() }),
      execute: async ({ sinceDays }) => {
        const since = sinceDays ? new Date(Date.now() - sinceDays * 86_400_000).toISOString() : undefined;
        const trades = await listStoredTrades({ since, limit: 5000 });
        if (!trades) return "Durable trade storage is not configured.";
        return compact(tradeStats(trades as never));
      },
    });
    tools.get_learning_status = tool({
      description: "DEVIANT learning pipeline status: stored market bars per symbol family and the latest model runs with test metrics versus DEVIANT v1 and Dwight.",
      inputSchema: z.object({}),
      execute: async () => {
        const [coverage, runs] = await Promise.all([barCoverage(), listModelRuns(5)]);
        return compact({
          coverage,
          runs: runs.map((r) => ({ id: r.id, status: r.status, outcome: r.report.status, message: r.report.message, test: r.report.metrics.test?.combined, baseline: r.report.metrics.baselineTest?.combined, dwight: r.report.metrics.dwightTest?.combined, rules: r.report.rules })),
        });
      },
    });
  }
  if (domain === "FINANCE" || agent.id === "EXECUTIVE") {
    tools.get_finance_state = tool({
      description: "Current finance runtime: mode (direct vs snapshot), liquidity, debt, stage and directive.",
      inputSchema: z.object({}),
      execute: async () => {
        const f = await getOrSeedFinanceState();
        return compact({ mode: f.mode, asOf: f.asOf, metrics: f.metrics, stage: f.currentStage, directive: financeDirective(f) });
      },
    });
  }
  if (domain === "CORE") {
    tools.run_infrastructure_check = tool({ description: "Measure runtime cache and durable storage health.", inputSchema: z.object({}), execute: async () => compact(await infrastructureCheck()) });
    tools.run_security_check = tool({ description: "Check owner login, cron auth and credential configuration (never returns secret values).", inputSchema: z.object({}), execute: async () => compact(securityCheck()) });
    tools.run_integrations_check = tool({ description: "Check Local Agent presence/version and market data freshness.", inputSchema: z.object({}), execute: async () => compact(await integrationsCheck()) });
  }
  if (agent.id === "SENTRYOPS_RESEARCH" && process.env.ANTHROPIC_API_KEY) {
    tools.web_search = anthropic.tools.webSearch_20250305({ maxUses: 5 }) as unknown as ToolSet[string];
  }
  if (agent.id === "BUILDER" && task.governance?.action === "USER_AUTHORIZED") {
    tools.dispatch_coding_run = tool({
      description: "Ask the Local Agent on Dwight's PC to run Claude Code on the jarvis-os repository with this precise engineering prompt. Edits stay local for Dwight to review; nothing is pushed.",
      inputSchema: z.object({ prompt: z.string().min(40).max(8000) }),
      execute: async ({ prompt }) => {
        const presence = await getLocalAgentPresence();
        if (!presence?.online) return "Local Agent is offline; cannot dispatch.";
        if (!presence.claudeCli) return "Claude Code CLI is not installed on the PC.";
        const command = await enqueueApprovedDesktopCommandForPresentDevice({ action: "RUN_CODING_AGENT", target: "CLAUDE", text: prompt });
        if (!command) return "No paired Local Agent found.";
        await recordApproval({ subjectType: "DESKTOP_ACTION", subjectId: command.id, decision: "APPROVED", decidedBy: "workforce:dwight-authorized-task:" + task.id, reason: "RUN_CODING_AGENT from Builder" });
        state.evidence.push(`dispatch:RUN_CODING_AGENT:${command.id}`);
        return `Dispatched coding run ${command.id}. Result will arrive in the Local Agent command results.`;
      },
    });
  }
  return tools;
}

export async function runAgentTask(agent: AgentState, task: AgentTask, context: string): Promise<AgentRunResult> {
  const choice = agentModel();
  if (!choice) {
    return { ok: false, result: "No model provider is configured (ANTHROPIC_API_KEY or OPENAI_API_KEY).", evidence: [], followups: [], toolCalls: 0, model: null };
  }
  const state = { evidence: [] as string[], followups: [] as AgentRunResult["followups"] };
  const tools = buildTools(agent, task, state);
  const system = [
    ROLE[agent.id] ?? `You are the ${agent.id} agent inside JARVIS.`,
    "Work only from tool results. If the data does not support a conclusion, say so plainly.",
    "Use record_finding for each conclusion worth keeping. Keep the final answer under 180 words: what you found, what it means, and the next step.",
    "Hard limits: no live trades, no money movement, no external messages, no secrets.",
    `Permission ceiling: ${agent.permissionCeiling}. Task definition of done: ${task.definitionOfDone ?? "n/a"}`,
  ].join("\n");
  try {
    const result = await generateText({
      model: choice.model,
      system,
      prompt: `TASK: ${task.title}\nPRIORITY: ${task.priority}\nCONTEXT:\n${context}`,
      tools,
      stopWhen: stepCountIs(8),
      maxOutputTokens: 1500,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(90_000),
    });
    const calls = result.steps.flatMap((step) => step.toolCalls.map((call) => call.toolName));
    const evidence = [
      ...calls.map((name) => `tool:${name}`),
      ...state.evidence,
    ].slice(0, 30);
    return {
      ok: Boolean(result.text.trim()),
      result: result.text.trim().slice(0, 2000) || "Agent finished without a written result.",
      evidence,
      followups: state.followups,
      toolCalls: calls.length,
      model: choice.id,
    };
  } catch (error) {
    return { ok: false, result: "Agent run failed: " + (error instanceof Error ? error.message : "unknown error"), evidence: [], followups: [], toolCalls: 0, model: choice.id };
  }
}
