import { financeDirective, getOrSeedFinanceState } from "./finance-live";
import { plaidFinanceConfigured, refreshFinanceFromPlaid } from "./plaid-finance";
import { runJarvisPulse } from "./jarvis-pulse";
import { getTradingState } from "./trading-runtime";
import { getJarvisIntegrationRegistry } from "./jarvis-integration-registry";
import {
  AgentId,
  AgentPermission,
  AgentState,
  AgentTask,
  AgentTaskPriority,
  WorkforceObjective,
  WorkforceState,
  appendRuntimeEvent,
  createRuntimeEvent,
  getLatestPulse,
  getLastPulseAt,
  getWorkforceState,
  setWorkforceState,
  shouldRunPulse,
} from "./jarvis-runtime";

const DEFAULT_AGENTS: AgentState[] = [
  {
    id: "EXECUTIVE",
    domain: "CORE",
    status: "IDLE",
    permissionCeiling: "WRITE_INTERNAL",
    lastRanAt: null,
    lastResult: "Executive orchestration has not completed its first cycle yet.",
    currentWork: "Coordinate specialist agents around Dwight's highest-leverage objectives.",
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
    lastResult: "Waiting for structured trading observations.",
    currentWork: "Study actual observed trading behavior without placing trades.",
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
  {
    id: "JARVIS_QA",
    domain: "CORE",
    status: "IDLE",
    permissionCeiling: "ANALYZE",
    lastRanAt: null,
    lastResult: "QA watchdog is waiting for its first workforce cycle.",
    currentWork: "Check agent failures, blockers, stale evidence, and reliability risks before JARVIS reports success.",
  },
  {
    id: "IT_INFRA",
    domain: "CORE",
    status: "IDLE",
    permissionCeiling: "WRITE_INTERNAL",
    lastRanAt: null,
    lastResult: "Infrastructure agent is standing by.",
    currentWork: "Watch runtime health, persistence, scheduled jobs, and core service availability.",
  },
  {
    id: "IT_SECURITY",
    domain: "CORE",
    status: "IDLE",
    permissionCeiling: "ANALYZE",
    lastRanAt: null,
    lastResult: "Security agent is standing by.",
    currentWork: "Audit security boundaries, secrets posture, authorization gates, and risky configuration drift.",
  },
  {
    id: "IT_INTEGRATIONS",
    domain: "CORE",
    status: "IDLE",
    permissionCeiling: "WRITE_INTERNAL",
    lastRanAt: null,
    lastResult: "Integration agent is standing by.",
    currentWork: "Watch connected systems and repair or surface broken integration paths without inventing connectivity.",
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

type TaskSeed = {
  title: string;
  domain: AgentTask["domain"];
  assignedTo: AgentId;
  priority: AgentTaskPriority;
  permissionRequired: AgentPermission;
  objectiveId: string | null;
  source: string;
};

export async function getOrSeedWorkforceState(): Promise<WorkforceState> {
  const existing = await getWorkforceState();
  if (existing) {
    const agents = mergeMissingAgents(existing.agents);
    const objectives = mergeMissingObjectives(existing.objectives);
    const tasks = Array.isArray(existing.tasks) ? existing.tasks : [];
    const changed =
      agents.length !== existing.agents.length ||
      objectives.length !== existing.objectives.length ||
      !Array.isArray(existing.tasks);

    if (!changed) return existing;

    const migrated: WorkforceState = { ...existing, agents, objectives, tasks };
    await setWorkforceState(migrated);
    return migrated;
  }

  const initial: WorkforceState = {
    version: 1,
    cycleId: null,
    lastCycleAt: null,
    status: "STARTING",
    agents: DEFAULT_AGENTS,
    objectives: DEFAULT_OBJECTIVES,
    tasks: [],
    executiveSummary: "JARVIS workforce is initialized and waiting for its first autonomous cycle.",
  };
  await setWorkforceState(initial);
  return initial;
}

export async function runWorkforceCycle(options: { forceResearch?: boolean } = {}): Promise<WorkforceState> {
  const previous = await getOrSeedWorkforceState();
  const now = new Date().toISOString();
  const cycleId = crypto.randomUUID();

  let agents = mergeMissingAgents(previous.agents);
  let tasks = pruneTasks(previous.tasks ?? []);

  await appendRuntimeEvent(
    createRuntimeEvent({
      type: "workforce.cycle_started",
      domain: "CORE",
      source: "jarvis.workforce",
      importance: "BACKGROUND",
      summary: "JARVIS workforce cycle started. Specialist agents are checking for useful work.",
    }),
  );

  const financeObjective = previous.objectives.find((objective) => objective.status === "ACTIVE" && objective.domain === "FINANCE") ?? null;
  const sentryObjective = previous.objectives.find((objective) => objective.status === "ACTIVE" && objective.domain === "SENTRYOPS") ?? null;

  const financeTaskResult = ensureTask(tasks, {
    title: "Review the active financial stage and next capital move",
    domain: "FINANCE",
    assignedTo: "FINANCE_CFO",
    priority: "HIGH",
    permissionRequired: "ANALYZE",
    objectiveId: financeObjective?.id ?? null,
    source: "workforce.cycle",
  });
  tasks = financeTaskResult.tasks;

  const sentryTaskResult = ensureTask(tasks, {
    title: "Refresh SentryOps market evidence and identify the strongest next move",
    domain: "SENTRYOPS",
    assignedTo: "SENTRYOPS_RESEARCH",
    priority: "HIGH",
    permissionRequired: "ANALYZE",
    objectiveId: sentryObjective?.id ?? null,
    source: "workforce.cycle",
  });
  tasks = sentryTaskResult.tasks;

  const tradingTaskResult = ensureTask(tasks, {
    title: "Inspect the latest Trading Observer state and preserve evidence quality",
    domain: "TRADING",
    assignedTo: "TRADING_OBSERVER",
    priority: "MEDIUM",
    permissionRequired: "READ",
    objectiveId: null,
    source: "workforce.cycle",
  });
  tasks = tradingTaskResult.tasks;

  const qaTaskResult = ensureTask(tasks, {
    title: "Audit the workforce cycle for failures, blockers, stale evidence, and false-success risk",
    domain: "CORE",
    assignedTo: "JARVIS_QA",
    priority: "HIGH",
    permissionRequired: "ANALYZE",
    objectiveId: null,
    source: "workforce.cycle",
  });
  tasks = qaTaskResult.tasks;

  const infraTaskResult = ensureTask(tasks, {
    title: "Check JARVIS infrastructure health and durable runtime dependencies",
    domain: "CORE",
    assignedTo: "IT_INFRA",
    priority: "HIGH",
    permissionRequired: "ANALYZE",
    objectiveId: null,
    source: "workforce.cycle",
  });
  tasks = infraTaskResult.tasks;

  const securityTaskResult = ensureTask(tasks, {
    title: "Audit security boundaries and automation authorization posture",
    domain: "CORE",
    assignedTo: "IT_SECURITY",
    priority: "HIGH",
    permissionRequired: "ANALYZE",
    objectiveId: null,
    source: "workforce.cycle",
  });
  tasks = securityTaskResult.tasks;

  const integrationsTaskResult = ensureTask(tasks, {
    title: "Check active JARVIS integrations for degradation or broken paths",
    domain: "CORE",
    assignedTo: "IT_INTEGRATIONS",
    priority: "HIGH",
    permissionRequired: "ANALYZE",
    objectiveId: null,
    source: "workforce.cycle",
  });
  tasks = integrationsTaskResult.tasks;

  tasks = updateTask(tasks, financeTaskResult.task.id, { status: "RUNNING", result: null, blockedReason: null });
  agents = setAgent(agents, "FINANCE_CFO", {
    status: "RUNNING",
    currentWork: "Refresh finance state when a direct provider is available, then evaluate the active financial stage.",
  });

  const financeRefresh = plaidFinanceConfigured() ? await refreshFinanceFromPlaid() : null;
  const finance = financeRefresh?.state ?? await getOrSeedFinanceState();
  const financeResult = financeRefresh?.refreshed
    ? `Direct finance refreshed. ${financeDirective(finance)}`
    : `${finance.mode === "DIRECT" ? "Direct finance state retained." : "Using the latest synchronized finance snapshot."} ${financeDirective(finance)}`;
  const financeFailed = Boolean(financeRefresh?.configured && !financeRefresh.refreshed);

  agents = setAgent(agents, "FINANCE_CFO", {
    status: financeFailed ? "ERROR" : "DONE",
    lastRanAt: now,
    lastResult: financeResult,
    currentWork: financeDirective(finance),
  });
  tasks = updateTask(tasks, financeTaskResult.task.id, {
    status: financeFailed ? "FAILED" : "DONE",
    result: financeResult,
    evidence: [`mode=${finance.mode}`, `asOf=${finance.asOf}`],
    blockedReason: financeFailed ? "The configured direct finance refresh did not complete successfully." : null,
  });
  await emitIfChanged(previous, agents, "FINANCE_CFO", "finance.cfo_cycle", financeResult);

  tasks = updateTask(tasks, sentryTaskResult.task.id, { status: "RUNNING", result: null, blockedReason: null });
  agents = setAgent(agents, "SENTRYOPS_RESEARCH", {
    status: "RUNNING",
    currentWork: "Research new evidence and compare it with the previous market pulse.",
  });

  const lastPulseAt = await getLastPulseAt();
  const researchDue = options.forceResearch === true || shouldRunPulse(lastPulseAt, 240);
  const previousPulse = await getLatestPulse();
  const sentryPulse = researchDue || !previousPulse ? await runJarvisPulse() : previousPulse;
  const sentryFailed = sentryPulse.status === "ERROR";
  const sentryResult = researchDue
    ? sentryPulse.summary
    : "Research pulse is current; no duplicate deep-research spend was needed this hourly workforce cycle. Latest: " + sentryPulse.summary;
  agents = setAgent(agents, "SENTRYOPS_RESEARCH", {
    status: sentryFailed ? "ERROR" : "DONE",
    lastRanAt: now,
    lastResult: sentryResult,
    currentWork: sentryPulse.nextMove.title,
  });
  tasks = updateTask(tasks, sentryTaskResult.task.id, {
    status: sentryFailed ? "FAILED" : "DONE",
    result: sentryResult,
    evidence: [`sources=${sentryPulse.sourceCount}`, `pulse=${sentryPulse.ranAt}`],
    blockedReason: sentryFailed ? "The SentryOps research pulse failed and will need a later retry." : null,
  });

  tasks = updateTask(tasks, tradingTaskResult.task.id, { status: "RUNNING", result: null, blockedReason: null });
  const tradingRuntime = await getTradingState();
  const observerOnline =
    tradingRuntime.account.connection === "OBSERVING" ||
    tradingRuntime.account.connection === "DEGRADED" ||
    Boolean(tradingRuntime.observer?.observedAt);
  const tradingResult = observerOnline
    ? `Observer active. ${tradingRuntime.observer?.symbol ?? "No active symbol"} · ${tradingRuntime.observer?.status ?? "UNKNOWN"} · ${tradingRuntime.today.trades} trade${tradingRuntime.today.trades === 1 ? "" : "s"} today.`
    : "Trading Observer is waiting for live observations from the Windows Local Agent.";

  agents = setAgent(agents, "TRADING_OBSERVER", {
    status: observerOnline ? "DONE" : "BLOCKED",
    lastRanAt: now,
    lastResult: tradingResult,
    currentWork: observerOnline
      ? "Study observed setup state, management changes, rule compliance, and journal outcomes without placing trades."
      : "Wait for the Local Agent to resume observation; do not invent trading evidence.",
  });
  tasks = updateTask(tasks, tradingTaskResult.task.id, {
    status: observerOnline ? "DONE" : "BLOCKED",
    result: tradingResult,
    evidence: [
      `connection=${tradingRuntime.account.connection}`,
      `observedAt=${tradingRuntime.observer?.observedAt ?? tradingRuntime.account.lastObservedAt ?? "none"}`,
    ],
    blockedReason: observerOnline ? null : "No current Local Agent observation is available.",
  });

  tasks = updateTask(tasks, infraTaskResult.task.id, { status: "RUNNING", result: null, blockedReason: null });
  tasks = updateTask(tasks, securityTaskResult.task.id, { status: "RUNNING", result: null, blockedReason: null });
  tasks = updateTask(tasks, integrationsTaskResult.task.id, { status: "RUNNING", result: null, blockedReason: null });

  const integrationRegistry = await getJarvisIntegrationRegistry();
  const coreIntegrationIds = new Set(["SUPABASE", "OBSIDIAN", "TRADING_OBSERVER"]);
  const coreIntegrations = integrationRegistry.filter((item) => coreIntegrationIds.has(item.id));
  const degradedCore = coreIntegrations.filter((item) => item.state === "DEGRADED");
  const activeIntegrations = integrationRegistry.filter((item) => item.state !== "NEEDS_APP_SETUP" && item.state !== "NEEDS_CONNECTION");
  const degradedConfigured = activeIntegrations.filter((item) => item.state === "DEGRADED");

  const infraResult = degradedCore.length
    ? "Infrastructure check found degraded core dependencies: " + degradedCore.map((item) => item.label).join(", ") + "."
    : "Infrastructure check passed for core persistence, Obsidian bridge registration, and Trading Observer registration.";
  agents = setAgent(agents, "IT_INFRA", {
    status: degradedCore.length ? "ERROR" : "DONE",
    lastRanAt: now,
    lastResult: infraResult,
    currentWork: degradedCore.length
      ? "Restore degraded core infrastructure before expanding automation."
      : "Keep core runtime, persistence, and scheduled work healthy.",
  });
  tasks = updateTask(tasks, infraTaskResult.task.id, {
    status: degradedCore.length ? "FAILED" : "DONE",
    result: infraResult,
    evidence: coreIntegrations.map((item) => item.id + "=" + item.state),
    blockedReason: degradedCore.length ? infraResult : null,
  });

  const securityFindings: string[] = [];
  if (process.env.VERCEL_ENV === "production" && !process.env.CRON_SECRET) securityFindings.push("CRON_SECRET missing in production");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) securityFindings.push("Supabase service role unavailable to server runtime");
  const securityResult = securityFindings.length
    ? "Security audit found configuration risks: " + securityFindings.join("; ") + "."
    : "Security audit passed baseline checks for cron authorization and server-side persistence credentials.";
  agents = setAgent(agents, "IT_SECURITY", {
    status: securityFindings.length ? "ERROR" : "DONE",
    lastRanAt: now,
    lastResult: securityResult,
    currentWork: securityFindings.length
      ? "Resolve the reported configuration risks without exposing secret values."
      : "Watch authorization boundaries and prevent agents from exceeding permission ceilings.",
  });
  tasks = updateTask(tasks, securityTaskResult.task.id, {
    status: securityFindings.length ? "FAILED" : "DONE",
    result: securityResult,
    evidence: [
      "cronSecret=" + (process.env.CRON_SECRET ? "configured" : "missing"),
      "supabaseServiceRole=" + (process.env.SUPABASE_SERVICE_ROLE_KEY ? "configured" : "missing"),
    ],
    blockedReason: securityFindings.length ? securityResult : null,
  });

  const integrationsResult = degradedConfigured.length
    ? "Integration check found degraded configured services: " + degradedConfigured.map((item) => item.label).join(", ") + "."
    : "Integration check found no degraded connected or authorization-ready services. Unused providers are ignored.";
  agents = setAgent(agents, "IT_INTEGRATIONS", {
    status: degradedConfigured.length ? "ERROR" : "DONE",
    lastRanAt: now,
    lastResult: integrationsResult,
    currentWork: degradedConfigured.length
      ? "Repair or isolate degraded connected services."
      : "Watch active connectors, Local Agent bridges, and provider handoffs.",
  });
  tasks = updateTask(tasks, integrationsTaskResult.task.id, {
    status: degradedConfigured.length ? "FAILED" : "DONE",
    result: integrationsResult,
    evidence: activeIntegrations.map((item) => item.id + "=" + item.state),
    blockedReason: degradedConfigured.length ? integrationsResult : null,
  });

  const activeBuildObjective = previous.objectives.find(
    (objective) =>
      objective.status === "ACTIVE" &&
      objective.domain !== "FINANCE" &&
      objective.domain !== "SENTRYOPS" &&
      !objective.id.startsWith("finance-") &&
      !objective.id.startsWith("sentryops-"),
  ) ?? null;

  if (activeBuildObjective) {
    const buildTaskResult = ensureTask(tasks, {
      title: `Turn objective into internal build plan: ${activeBuildObjective.title}`,
      domain: activeBuildObjective.domain,
      assignedTo: "BUILDER",
      priority: "HIGH",
      permissionRequired: "WRITE_INTERNAL",
      objectiveId: activeBuildObjective.id,
      source: "workforce.objective",
    });
    tasks = buildTaskResult.tasks;
    const buildPlan = buildPlanForObjective(activeBuildObjective);
    agents = setAgent(agents, "BUILDER", {
      status: "DONE",
      lastRanAt: now,
      lastResult: buildPlan,
      currentWork: activeBuildObjective.currentFocus,
    });
    tasks = updateTask(tasks, buildTaskResult.task.id, {
      status: "DONE",
      result: buildPlan,
      evidence: [`objective=${activeBuildObjective.id}`],
      blockedReason: null,
    });
  } else {
    agents = setAgent(agents, "BUILDER", {
      status: "IDLE",
      lastRanAt: now,
      lastResult: "No separate build objective needs work this cycle. Builder remains available.",
      currentWork: "Stand by for a concrete software or business objective from Dwight.",
    });
  }

  tasks = updateTask(tasks, qaTaskResult.task.id, { status: "RUNNING", result: null, blockedReason: null });
  const qa = auditCycle(agents, tasks);
  agents = setAgent(agents, "JARVIS_QA", {
    status: qa.hasErrors ? "ERROR" : qa.hasBlockers ? "BLOCKED" : "DONE",
    lastRanAt: now,
    lastResult: qa.summary,
    currentWork: qa.nextCheck,
  });
  tasks = updateTask(tasks, qaTaskResult.task.id, {
    status: qa.hasErrors ? "FAILED" : qa.hasBlockers ? "BLOCKED" : "DONE",
    result: qa.summary,
    evidence: qa.evidence,
    blockedReason: qa.hasBlockers && !qa.hasErrors ? qa.blockedReason : qa.hasErrors ? "At least one workforce agent reported an error." : null,
  });

  const executiveSummary = synthesizeExecutiveSummary({
    financeResult,
    sentryResult,
    tradingResult,
    qaSummary: qa.summary,
  });
  const degraded = agents.some((agent) => agent.status === "ERROR");

  agents = setAgent(agents, "EXECUTIVE", {
    status: degraded ? "ERROR" : "DONE",
    lastRanAt: now,
    lastResult: executiveSummary,
    currentWork: chooseExecutiveFocus(finance, sentryPulse.status, sentryPulse.nextMove.title, tasks),
  });

  const next: WorkforceState = {
    version: 1,
    cycleId,
    lastCycleAt: now,
    status: degraded ? "DEGRADED" : "ACTIVE",
    agents,
    objectives: previous.objectives,
    tasks: pruneTasks(tasks),
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
    currentFocus: input.currentFocus?.trim().slice(0, 500) || "JARVIS will decompose the objective into the highest-leverage low-risk work it can perform with connected tools.",
    requiresApprovalForExternalActions: true,
  };

  const next: WorkforceState = {
    ...state,
    objectives: [objective, ...state.objectives].slice(0, 30),
  };
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

export async function addWorkforceTask(input: {
  title: string;
  domain?: AgentTask["domain"];
  assignedTo?: AgentId;
  priority?: AgentTaskPriority;
  permissionRequired?: AgentPermission;
  objectiveId?: string | null;
  source?: string;
}): Promise<AgentTask> {
  const state = await getOrSeedWorkforceState();
  const now = new Date().toISOString();
  const assignedTo = input.assignedTo ?? defaultAgentForDomain(input.domain ?? "CORE");
  const agent = state.agents.find((candidate) => candidate.id === assignedTo);
  const permissionRequired = input.permissionRequired ?? "ANALYZE";
  const allowed = permissionWithinCeiling(permissionRequired, agent?.permissionCeiling ?? "READ");

  const task: AgentTask = {
    id: crypto.randomUUID(),
    title: input.title.trim().slice(0, 220),
    domain: input.domain ?? agent?.domain ?? "CORE",
    assignedTo,
    status: allowed ? "QUEUED" : "WAITING_APPROVAL",
    priority: input.priority ?? "MEDIUM",
    permissionRequired,
    createdAt: now,
    updatedAt: now,
    objectiveId: input.objectiveId ?? null,
    source: input.source?.trim().slice(0, 120) || "jarvis.executive",
    result: null,
    evidence: [],
    blockedReason: allowed ? null : `Task requires ${permissionRequired}, above ${assignedTo}'s ${agent?.permissionCeiling ?? "READ"} permission ceiling.`,
  };

  const next: WorkforceState = {
    ...state,
    tasks: pruneTasks([task, ...(state.tasks ?? [])]),
  };
  await setWorkforceState(next);

  await appendRuntimeEvent(
    createRuntimeEvent({
      type: "workforce.task_created",
      domain: task.domain,
      source: task.source,
      importance: task.priority === "CRITICAL" ? "CRITICAL" : task.priority === "HIGH" ? "IMPORTANT" : "NORMAL",
      summary: `${task.assignedTo} assigned: ${task.title}${task.status === "WAITING_APPROVAL" ? " · approval required" : ""}`,
    }),
  );

  return task;
}

function mergeMissingAgents(existing: AgentState[]) {
  return DEFAULT_AGENTS.map((fallback) => existing.find((agent) => agent.id === fallback.id) ?? fallback);
}

function mergeMissingObjectives(existing: WorkforceObjective[]) {
  const current = [...existing];
  for (const fallback of DEFAULT_OBJECTIVES) {
    if (!current.some((objective) => objective.id === fallback.id)) current.push(fallback);
  }
  return current;
}

function setAgent(agents: AgentState[], id: AgentId, patch: Partial<AgentState>) {
  return agents.map((agent) => (agent.id === id ? { ...agent, ...patch } : agent));
}

function ensureTask(tasks: AgentTask[], seed: TaskSeed) {
  const existing = tasks.find((task) =>
    task.title === seed.title &&
    task.assignedTo === seed.assignedTo &&
    ["QUEUED", "RUNNING"].includes(task.status),
  );
  if (existing) return { tasks, task: existing };

  const now = new Date().toISOString();
  const task: AgentTask = {
    id: crypto.randomUUID(),
    ...seed,
    status: "QUEUED",
    createdAt: now,
    updatedAt: now,
    result: null,
    evidence: [],
    blockedReason: null,
  };
  return { tasks: [task, ...tasks], task };
}

function updateTask(tasks: AgentTask[], id: string, patch: Partial<AgentTask>) {
  const updatedAt = new Date().toISOString();
  return tasks.map((task) => task.id === id ? { ...task, ...patch, updatedAt } : task);
}

function pruneTasks(tasks: AgentTask[]) {
  const open = tasks.filter((task) => ["QUEUED", "RUNNING", "BLOCKED", "WAITING_APPROVAL"].includes(task.status));
  const closed = tasks
    .filter((task) => !["QUEUED", "RUNNING", "BLOCKED", "WAITING_APPROVAL"].includes(task.status))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 70);
  return [...open, ...closed].slice(0, 100);
}

function defaultAgentForDomain(domain: AgentTask["domain"]): AgentId {
  if (domain === "FINANCE") return "FINANCE_CFO";
  if (domain === "SENTRYOPS") return "SENTRYOPS_RESEARCH";
  if (domain === "TRADING") return "TRADING_OBSERVER";
  return "BUILDER";
}

function permissionWithinCeiling(required: AgentPermission, ceiling: AgentPermission) {
  const rank: Record<AgentPermission, number> = {
    READ: 0,
    ANALYZE: 1,
    WRITE_INTERNAL: 2,
    EXTERNAL_LOW_RISK: 3,
    REQUIRES_APPROVAL: 4,
  };
  return rank[required] <= rank[ceiling] && required !== "REQUIRES_APPROVAL";
}

function buildPlanForObjective(objective: WorkforceObjective) {
  return [
    `Objective: ${objective.title}.`,
    `Success: ${objective.successDefinition}`,
    `Current focus: ${objective.currentFocus}`,
    "Builder prepared internal work only. Publishing, spending, outreach, account changes, and other consequential external actions remain approval-gated.",
  ].join(" ");
}

function auditCycle(agents: AgentState[], tasks: AgentTask[]) {
  const failures = agents.filter((agent) => agent.status === "ERROR");
  const blockers = agents.filter((agent) => agent.status === "BLOCKED");
  const waitingApproval = tasks.filter((task) => task.status === "WAITING_APPROVAL");
  const running = tasks.filter((task) => task.status === "RUNNING");

  const evidence = [
    `errors=${failures.length}`,
    `blockedAgents=${blockers.length}`,
    `waitingApproval=${waitingApproval.length}`,
    `stillRunning=${running.length}`,
  ];

  if (failures.length) {
    return {
      hasErrors: true,
      hasBlockers: blockers.length > 0,
      summary: `QA found ${failures.length} agent error${failures.length === 1 ? "" : "s"}: ${failures.map((agent) => agent.id).join(", ")}. JARVIS must not report a clean cycle.`,
      nextCheck: "Re-check failed agents after their provider or data dependency recovers.",
      evidence,
      blockedReason: failures.map((agent) => `${agent.id}: ${agent.lastResult}`).join(" | "),
    };
  }

  if (blockers.length || waitingApproval.length) {
    return {
      hasErrors: false,
      hasBlockers: true,
      summary: `QA found no agent errors, but ${blockers.length} agent${blockers.length === 1 ? "" : "s"} are blocked and ${waitingApproval.length} task${waitingApproval.length === 1 ? "" : "s"} await approval.`,
      nextCheck: "Watch blocked dependencies and surface approval requests without bypassing them.",
      evidence,
      blockedReason: blockers.map((agent) => `${agent.id}: ${agent.lastResult}`).join(" | ") || "Approval-gated work is waiting.",
    };
  }

  return {
    hasErrors: false,
    hasBlockers: false,
    summary: "QA verified the cycle: no agent errors, no blocked agents, and no approval-gated tasks were hidden.",
    nextCheck: "Continue checking evidence freshness and task outcomes on the next cycle.",
    evidence,
    blockedReason: null,
  };
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

function synthesizeExecutiveSummary(input: {
  financeResult: string;
  sentryResult: string;
  tradingResult: string;
  qaSummary: string;
}) {
  return [
    `Finance: ${input.financeResult}`,
    `SentryOps: ${input.sentryResult}`,
    `Trading: ${input.tradingResult}`,
    `QA: ${input.qaSummary}`,
  ].join(" ").slice(0, 900);
}

function chooseExecutiveFocus(
  finance: Awaited<ReturnType<typeof getOrSeedFinanceState>>,
  sentryStatus: string,
  sentryNext: string,
  tasks: AgentTask[],
) {
  const approvalTask = tasks.find((task) => task.status === "WAITING_APPROVAL");
  if (approvalTask) return `Review approval request: ${approvalTask.title}`;
  const highPriorityOpen = tasks.find((task) => ["QUEUED", "BLOCKED"].includes(task.status) && (task.priority === "CRITICAL" || task.priority === "HIGH"));
  if (highPriorityOpen) return `${highPriorityOpen.assignedTo}: ${highPriorityOpen.title}`;
  if (finance.metrics.personalDebt > 0) return financeDirective(finance);
  if (sentryStatus !== "ERROR" && sentryNext) return sentryNext;
  return "Keep the financial path moving while waiting for the next evidence-backed specialist action.";
}
