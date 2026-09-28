import { financeDirective, getOrSeedFinanceState } from "./finance-live";
import { plaidFinanceConfigured, refreshFinanceFromPlaid } from "./plaid-finance";
import { runJarvisPulse } from "./jarvis-pulse";
import { getTradingState } from "./trading-runtime";
import {
  AgentId,
  AgentState,
  WorkforceObjective,
  WorkforceState,
  appendRuntimeEvent,
  createRuntimeEvent,
  getWorkforceState,
  setWorkforceState,
} from "./jarvis-runtime";

const DEFAULT_AGENTS: AgentState[] = [
  {
    id: "EXECUTIVE",
    domain: "CORE",
    status: "IDLE",
    permissionCeiling: "WRITE_INTERNAL",
    lastRanAt: null,
    lastResult: "Executive orchestration has not completed its first cycle yet.",
    currentWork: "Coordinate the specialist agents around Dwight's highest-leverage objectives.",
  },
  {
    id: "FINANCE_CFO",
    domain: "FINANCE",
    status: "IDLE",
    permissionCeiling: "WRITE_INTERNAL",
    lastRanAt: null,
    lastResult: "Finance agent is waiting for its first cycle.",
    currentWork: "Keep financial state current and advance the active capital stage.",
  },
  {
    id: "SENTRYOPS_RESEARCH",
    domain: "SENTRYOPS",
    status: "IDLE",
    permissionCeiling: "ANALYZE",
    lastRanAt: null,
    lastResult: "Research agent is waiting for its first cycle.",
    currentWork: "Find evidence-backed public-safety software opportunities.",
  },
  {
    id: "TRADING_OBSERVER",
    domain: "TRADING",
    status: "BLOCKED",
    permissionCeiling: "READ",
    lastRanAt: null,
    lastResult: "Blocked until the trading recorder/data feed exists.",
    currentWork: "Wait for structured trade observations rather than inventing trading evidence.",
  },
  {
    id: "BUILDER",
    domain: "CORE",
    status: "IDLE",
    permissionCeiling: "WRITE_INTERNAL",
    lastRanAt: null,
    lastResult: "Builder is available for approved software and business objectives.",
    currentWork: "Turn validated objectives into internal plans and build tasks without taking unapproved external actions.",
  },
];

const DEFAULT_OBJECTIVES: WorkforceObjective[] = [
  {
    id: "finance-capital-path",
    title: "Advance Dwight through the financial path toward $1M net worth",
    domain: "FINANCE",
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
    status: "ACTIVE",
    successDefinition: "Debt controlled, liquidity and credit strengthened, capital compounds, and net worth milestones keep advancing toward $1M.",
    currentFocus: "Debt → stability → reserves → credit → capital → investing → assets.",
    requiresApprovalForExternalActions: true,
  },
  {
    id: "sentryops-product-market",
    title: "Discover and validate the strongest SentryOps product opportunity",
    domain: "SENTRYOPS",
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
    status: "ACTIVE",
    successDefinition: "Evidence supports a repeatable painful problem, identifiable buyer, budget path, competitive wedge, product direction, and pilot path.",
    currentFocus: "Research agencies, contracts, vendors, workflows, pain, budgets, and repeatability before forcing a product conclusion.",
    requiresApprovalForExternalActions: true,
  },
];

export async function getOrSeedWorkforceState(): Promise<WorkforceState> {
  const existing = await getWorkforceState();
  if (existing) return existing;

  const initial: WorkforceState = {
    version: 1,
    cycleId: null,
    lastCycleAt: null,
    status: "STARTING",
    agents: DEFAULT_AGENTS,
    objectives: DEFAULT_OBJECTIVES,
    executiveSummary: "Jarvis workforce is initialized and waiting for its first autonomous cycle.",
  };
  await setWorkforceState(initial);
  return initial;
}

export async function runWorkforceCycle(): Promise<WorkforceState> {
  const previous = await getOrSeedWorkforceState();
  const now = new Date().toISOString();
  const cycleId = crypto.randomUUID();

  let agents = previous.agents.map((agent) => ({ ...agent }));

  await appendRuntimeEvent(
    createRuntimeEvent({
      type: "workforce.cycle_started",
      domain: "CORE",
      source: "jarvis.workforce",
      importance: "BACKGROUND",
      summary: "Autonomous Jarvis cycle started. Finance, SentryOps, and executive lanes are checking for useful work.",
    }),
  );

  agents = setAgent(agents, "FINANCE_CFO", { status: "RUNNING", currentWork: "Refresh finance state when a direct provider is available, then evaluate the active financial stage." });
  const financeRefresh = plaidFinanceConfigured() ? await refreshFinanceFromPlaid() : null;
  const finance = financeRefresh?.state ?? await getOrSeedFinanceState();
  const financeResult = financeRefresh?.refreshed
    ? `Direct finance refreshed. ${financeDirective(finance)}`
    : `${finance.mode === "DIRECT" ? "Direct finance state retained." : "Using the latest synchronized finance snapshot."} ${financeDirective(finance)}`;
  agents = setAgent(agents, "FINANCE_CFO", {
    status: financeRefresh?.configured && !financeRefresh.refreshed ? "ERROR" : "DONE",
    lastRanAt: now,
    lastResult: financeResult,
    currentWork: financeDirective(finance),
  });
  await emitIfChanged(previous, agents, "FINANCE_CFO", "finance.cfo_cycle", financeResult);

  agents = setAgent(agents, "SENTRYOPS_RESEARCH", { status: "RUNNING", currentWork: "Research new evidence and compare it with the previous market pulse." });
  const sentryPulse = await runJarvisPulse();
  const sentryStatus = sentryPulse.status === "ERROR" ? "ERROR" : "DONE";
  const sentryResult = sentryPulse.summary;
  agents = setAgent(agents, "SENTRYOPS_RESEARCH", {
    status: sentryStatus,
    lastRanAt: now,
    lastResult: sentryResult,
    currentWork: sentryPulse.nextMove.title,
  });

  const tradingRuntime = await getTradingState();
  const trading = agents.find((agent) => agent.id === "TRADING_OBSERVER");
  if (trading) {
    const observerOnline =
      tradingRuntime.account.connection === "OBSERVING" ||
      tradingRuntime.account.connection === "DEGRADED" ||
      Boolean(tradingRuntime.observer?.observedAt);

    Object.assign(trading, {
      status: observerOnline ? "DONE" as const : "BLOCKED" as const,
      lastRanAt: now,
      lastResult: observerOnline
        ? `Observer active. ${tradingRuntime.observer?.symbol ?? "No active symbol"} · ${tradingRuntime.observer?.status ?? "UNKNOWN"} · ${tradingRuntime.today.trades} trade${tradingRuntime.today.trades === 1 ? "" : "s"} today.`
        : "Trading observer is waiting for live observations from the Windows Local Agent.",
      currentWork: observerOnline
        ? "Study observed setup state, management changes, rule compliance, and journal outcomes without placing trades."
        : "Wait for the Local Agent to resume observation; do not invent trading evidence.",
    });
  }

  const activeBuildObjective = previous.objectives.find(
    (objective) => objective.status === "ACTIVE" && objective.domain !== "FINANCE" && objective.domain !== "SENTRYOPS",
  );
  agents = setAgent(agents, "BUILDER", {
    status: activeBuildObjective ? "DONE" : "IDLE",
    lastRanAt: now,
    lastResult: activeBuildObjective
      ? `Converted the active objective "${activeBuildObjective.title}" into internal build work. External publishing, spending, outreach, or production mutations still require the relevant authorized connector and permission.`
      : "No separate build objective needs work this cycle. Builder remains available.",
    currentWork: activeBuildObjective?.currentFocus ?? "Stand by for a concrete software, commerce, or business objective from Dwight.",
  });

  const executiveSummary = synthesizeExecutiveSummary(financeResult, sentryPulse.summary, sentryPulse.status);
  const degraded = agents.some((agent) => agent.status === "ERROR");
  agents = setAgent(agents, "EXECUTIVE", {
    status: degraded ? "ERROR" : "DONE",
    lastRanAt: now,
    lastResult: executiveSummary,
    currentWork: chooseExecutiveFocus(finance, sentryPulse.status, sentryPulse.nextMove.title),
  });

  const next: WorkforceState = {
    version: 1,
    cycleId,
    lastCycleAt: now,
    status: degraded ? "DEGRADED" : "ACTIVE",
    agents,
    objectives: previous.objectives,
    executiveSummary,
  };

  await setWorkforceState(next);
  await appendRuntimeEvent(
    createRuntimeEvent({
      type: "workforce.cycle_completed",
      domain: "CORE",
      source: "jarvis.workforce",
      importance: degraded ? "IMPORTANT" : "NORMAL",
      summary: executiveSummary,
    }),
  );

  return next;
}

export async function addWorkforceObjective(input: {
  title: string;
  domain?: WorkforceObjective["domain"];
  successDefinition?: string;
  currentFocus?: string;
}): Promise<WorkforceObjective> {
  const state = await getOrSeedWorkforceState();
  const now = new Date().toISOString();
  const objective: WorkforceObjective = {
    id: crypto.randomUUID(),
    title: input.title.trim().slice(0, 180),
    domain: input.domain ?? "CORE",
    createdAt: now,
    updatedAt: now,
    status: "ACTIVE",
    successDefinition: input.successDefinition?.trim().slice(0, 500) || "Objective is achieved when Dwight's requested outcome is measurably complete.",
    currentFocus: input.currentFocus?.trim().slice(0, 500) || "Jarvis will decompose the objective into the highest-leverage low-risk work it can perform with connected tools.",
    requiresApprovalForExternalActions: true,
  };

  const next = { ...state, objectives: [objective, ...state.objectives].slice(0, 30) };
  await setWorkforceState(next);
  await appendRuntimeEvent(
    createRuntimeEvent({
      type: "objective.created",
      domain: objective.domain,
      source: "jarvis.executive",
      importance: "IMPORTANT",
      summary: `New objective accepted: ${objective.title}`,
    }),
  );
  return objective;
}

function setAgent(agents: AgentState[], id: AgentId, patch: Partial<AgentState>) {
  return agents.map((agent) => (agent.id === id ? { ...agent, ...patch } : agent));
}

async function emitIfChanged(previous: WorkforceState, nextAgents: AgentState[], id: AgentId, type: string, summary: string) {
  const before = previous.agents.find((agent) => agent.id === id)?.lastResult;
  const after = nextAgents.find((agent) => agent.id === id)?.lastResult;
  if (before === after) return;
  const domain = nextAgents.find((agent) => agent.id === id)?.domain ?? "CORE";
  await appendRuntimeEvent(
    createRuntimeEvent({ type, domain, source: `jarvis.agent.${id.toLowerCase()}`, importance: "NORMAL", summary }),
  );
}

function synthesizeExecutiveSummary(financeResult: string, sentrySummary: string, sentryStatus: string) {
  const sentry = sentryStatus === "ERROR"
    ? "SentryOps research could not complete this cycle and will retry."
    : `SentryOps research completed: ${sentrySummary}`;
  return `Finance: ${financeResult} ${sentry}`.slice(0, 500);
}

function chooseExecutiveFocus(finance: Awaited<ReturnType<typeof getOrSeedFinanceState>>, sentryStatus: string, sentryNext: string) {
  if (finance.metrics.personalDebt > 0) return financeDirective(finance);
  if (sentryStatus !== "ERROR" && sentryNext) return sentryNext;
  return "Keep the financial path moving while waiting for the next evidence-backed specialist action.";
}
