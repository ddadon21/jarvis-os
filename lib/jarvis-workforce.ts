import { financeDirective, getOrSeedFinanceState } from "./finance-live";
import { plaidFinanceConfigured, refreshFinanceFromPlaid } from "./plaid-finance";
import { getTradingState } from "./trading-runtime";
import { getJarvisIntegrationRegistry } from "./jarvis-integration-registry";
import { JARVIS_BALANCED_GOVERNANCE, JARVIS_OPERATING_DOCTRINE } from "./jarvis-core-policy";
import { infrastructureCheck, integrationsCheck, securityCheck } from "./workforce-checks";
import { runAgentTask } from "./workforce-agents";
import { recordApproval } from "./approvals";
import {
  AgentId,
  AgentPermission,
  AgentState,
  AgentTask,
  AgentTaskPriority,
  isAgentId,
  WorkforceGap,
  WorkforceGovernanceDecision,
  WorkforceObjective,
  WorkforceOperatingSystem,
  WorkforceState,
  appendRuntimeEvent,
  createRuntimeEvent,
  getLatestPulse,
  getRecentEvents,
  getWorkforceState,
  setWorkforceState,
} from "./jarvis-runtime";

const OPERATING_DOCTRINE = [...JARVIS_OPERATING_DOCTRINE];
const BALANCED_GOVERNANCE = JARVIS_BALANCED_GOVERNANCE;
const BORING_WORK = [
  "Review stale or ownerless tasks",
  "Verify durable persistence and recovery paths",
  "Reproduce unresolved bugs before adding features",
  "Check duplicate workflow / agent logic",
  "Validate backups, authorization, and security boundaries",
  "Document fixes so the same failure does not recur",
];

const DEFAULT_AGENTS: AgentState[] = [
  {
    id: "TRADING_OBSERVER",
    domain: "TRADING",
    status: "BLOCKED",
    permissionCeiling: "WRITE_INTERNAL",
    lastRanAt: null,
    lastResult: "Waiting for structured trading observations.",
    currentWork: "Observe how Dwight trades, then refine and backtest the arrow indicator for more precise entries. Never places trades.",
  },
  {
    id: "DEAL_FINDER",
    domain: "SENTRYOPS",
    status: "BLOCKED",
    permissionCeiling: "ANALYZE",
    lastRanAt: null,
    lastResult: "Waiting for deal criteria and a property data source.",
    currentWork: "Find fix-and-flip deals that match Dwight's criteria and learn from the deals he picks.",
  },
  {
    id: "SUPERVISOR",
    domain: "CORE",
    status: "IDLE",
    permissionCeiling: "WRITE_INTERNAL",
    lastRanAt: null,
    lastResult: "Supervisor has not completed its first cycle yet.",
    currentWork: "Keep the Trading Observer and Deal Finder honest: verify their evidence, check system health, and report.",
  },
];

const DEFAULT_OBJECTIVES: WorkforceObjective[] = [
  {
    id: "trading-arrow-indicator",
    title: "Make the arrow indicator precise enough to trade from on its own",
    domain: "TRADING",
    createdAt: "2026-11-09T00:00:00.000Z",
    updatedAt: "2026-11-09T00:00:00.000Z",
    status: "ACTIVE",
    successDefinition: "Backtested and forward-observed arrow signals show a consistently high win rate with clear entry criteria, versioned against the baseline indicator.",
    currentFocus: "Observe Dwight's trades → find what separates his best entries → propose versioned indicator changes → backtest before adopting.",
    requiresApprovalForExternalActions: true,
  },
  {
    id: "real-estate-fix-flip",
    title: "Find the best fix-and-flip deals that match Dwight's criteria",
    domain: "SENTRYOPS",
    createdAt: "2026-11-09T00:00:00.000Z",
    updatedAt: "2026-11-09T00:00:00.000Z",
    status: "ACTIVE",
    successDefinition: "A steady flow of deals that pass every criterion, ranked by profit, getting better over time from the deals Dwight chooses.",
    currentFocus: "Lock criteria → connect a property data source → search target areas → score and rank → learn from Dwight's picks.",
    requiresApprovalForExternalActions: true,
  },
];

/** Objectives from the retired workforce (finance CFO, SentryOps research) are dropped on load. */
const RETIRED_OBJECTIVE_IDS = new Set(["finance-capital-path", "sentryops-product-market"]);

type TaskSeed = {
  title: string;
  domain: AgentTask["domain"];
  assignedTo: AgentId;
  priority: AgentTaskPriority;
  permissionRequired: AgentPermission;
  objectiveId: string | null;
  source: string;
  definitionOfDone?: string;
};

export async function getOrSeedWorkforceState(): Promise<WorkforceState> {
  const existing = await getWorkforceState();
  if (existing) {
    const workforceEnabled = existing.autonomy?.enabled === true;
    const mergedAgents = mergeMissingAgents(existing.agents);
    const agents = workforceEnabled
      ? mergedAgents
      : mergedAgents.map((agent) => ({
          ...agent,
          status: "IDLE" as const,
        }));
    const objectives = mergeMissingObjectives(existing.objectives);
    const legacyRoster = existing.agents.some((agent) => !isAgentId(agent.id)) ||
      (existing.tasks ?? []).some((task) => !isAgentId(task.assignedTo));
    const tasks = pruneTasks((Array.isArray(existing.tasks) ? existing.tasks : []).filter((task) => isAgentId(task.assignedTo)).map((task) => ({
      ...task,
      definitionOfDone: task.definitionOfDone?.trim() || defaultDefinitionOfDone(task),
      governance: task.governance ?? classifyTaskGovernance({
        title: task.title,
        domain: task.domain,
        assignedTo: task.assignedTo,
        priority: task.priority,
        permissionRequired: task.permissionRequired,
        objectiveId: task.objectiveId,
        source: task.source,
      }),
    })));
    const taskSetChanged = tasks.length !== (existing.tasks?.length ?? 0);
    const needsInstitutionalMigration =
      legacyRoster ||
      !existing.operatingSystem?.truth ||
      !existing.operatingSystem?.worldState ||
      !existing.operatingSystem?.decisionMemory ||
      !existing.operatingSystem?.scenarios ||
      !existing.operatingSystem?.opportunities ||
      !existing.operatingSystem?.metrics ||
      !existing.operatingSystem?.capitalDesk ||
      !existing.operatingSystem?.continuity;
    const shouldRebuildOperatingPicture = needsInstitutionalMigration || taskSetChanged;
    const rebuiltOperatingSystem = shouldRebuildOperatingPicture
      ? buildOperatingSystem({
          previous: legacyRoster ? null : existing,
          agents,
          tasks: applyTruthVerification(tasks, new Date().toISOString()),
          executiveFocus: existing.executiveSummary || "Close the highest-risk open loop before expanding.",
        })
      : null;
    const operatingSystem = existing.operatingSystem && !shouldRebuildOperatingPicture
      ? {
          ...existing.operatingSystem,
          governance: existing.operatingSystem.governance ?? BALANCED_GOVERNANCE,
        }
      : existing.operatingSystem && rebuiltOperatingSystem && taskSetChanged && !needsInstitutionalMigration
        ? {
            ...rebuiltOperatingSystem,
            governance: existing.operatingSystem.governance ?? BALANCED_GOVERNANCE,
            worldState: existing.operatingSystem.worldState,
            scenarios: existing.operatingSystem.scenarios,
            opportunities: existing.operatingSystem.opportunities,
            capitalDesk: existing.operatingSystem.capitalDesk,
          }
        : rebuiltOperatingSystem!;
    const changed =
      agents.length !== existing.agents.length ||
      objectives.length !== existing.objectives.length ||
      !Array.isArray(existing.tasks) ||
      taskSetChanged ||
      !existing.operatingSystem ||
      needsInstitutionalMigration ||
      tasks.some((task, index) =>
        task.definitionOfDone !== existing.tasks?.[index]?.definitionOfDone ||
        !existing.tasks?.[index]?.governance
      ) ||
      !existing.operatingSystem?.governance ||
      agents.some((agent, index) => agent.status !== existing.agents[index]?.status);

    if (!changed) return existing;

    const migrated: WorkforceState = { ...existing, agents, objectives, tasks, operatingSystem };
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
    operatingSystem: buildOperatingSystem({
      previous: null,
      agents: DEFAULT_AGENTS,
      tasks: [],
      executiveFocus: "Establish the operating picture, then close the highest-risk gap.",
    }),
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

  const tradingObjective = previous.objectives.find((objective) => objective.status === "ACTIVE" && objective.domain === "TRADING") ?? null;
  const dealObjective = previous.objectives.find((objective) => objective.status === "ACTIVE" && objective.domain === "SENTRYOPS") ?? null;

  const tradingTaskResult = ensureTask(tasks, {
    title: "Review observed trades and arrow indicator evidence",
    domain: "TRADING",
    assignedTo: "TRADING_OBSERVER",
    priority: "HIGH",
    permissionRequired: "READ",
    objectiveId: tradingObjective?.id ?? null,
    source: "workforce.cycle",
  });
  tasks = tradingTaskResult.tasks;

  const dealTaskResult = ensureTask(tasks, {
    title: "Search target areas for fix-and-flip deals that match criteria",
    domain: "SENTRYOPS",
    assignedTo: "DEAL_FINDER",
    priority: "HIGH",
    permissionRequired: "ANALYZE",
    objectiveId: dealObjective?.id ?? null,
    source: "workforce.cycle",
  });
  tasks = dealTaskResult.tasks;

  const supervisorTaskResult = ensureTask(tasks, {
    title: "Check both agents and system health for failures, stale evidence, and false-success risk",
    domain: "CORE",
    assignedTo: "SUPERVISOR",
    priority: "HIGH",
    permissionRequired: "ANALYZE",
    objectiveId: null,
    source: "workforce.cycle",
  });
  tasks = supervisorTaskResult.tasks;

  // Trading Observer: live observation state plus any new indicator evidence.
  tasks = updateTask(tasks, tradingTaskResult.task.id, { status: "RUNNING", result: null, blockedReason: null });
  const tradingRuntime = await getTradingState();
  const observerOnline =
    tradingRuntime.account.connection === "OBSERVING" ||
    tradingRuntime.account.connection === "DEGRADED" ||
    Boolean(tradingRuntime.observer?.observedAt);
  const recentEvents = await getRecentEvents();
  const latestIndicatorEvidence = recentEvents.find((event) => event.type === "trading.indicator_evidence") ?? null;
  const indicatorNote = latestIndicatorEvidence
    ? ` New indicator evidence: ${latestIndicatorEvidence.summary.slice(0, 200)} The baseline Pine file stays immutable; changes must be versioned and backtested against repeated evidence, not one screenshot.`
    : "";
  const tradingResult = (observerOnline
    ? `Observer active. ${tradingRuntime.observer?.symbol ?? "No active symbol"} · ${tradingRuntime.observer?.status ?? "UNKNOWN"} · ${tradingRuntime.today.trades} trade${tradingRuntime.today.trades === 1 ? "" : "s"} today.`
    : "Waiting for live observations from the Windows Local Agent.") + indicatorNote;

  agents = setAgent(agents, "TRADING_OBSERVER", {
    status: observerOnline ? "DONE" : "BLOCKED",
    lastRanAt: now,
    lastResult: tradingResult,
    currentWork: observerOnline
      ? "Study entries, exits and rule compliance; correlate with arrow signals to find what makes entries precise."
      : "Wait for the Local Agent to resume observation; do not invent trading evidence.",
  });
  tasks = updateTask(tasks, tradingTaskResult.task.id, {
    status: observerOnline ? "DONE" : "BLOCKED",
    result: tradingResult,
    evidence: [
      `connection=${tradingRuntime.account.connection}`,
      `observedAt=${tradingRuntime.observer?.observedAt ?? tradingRuntime.account.lastObservedAt ?? "none"}`,
      ...(latestIndicatorEvidence ? [`runtimeEvent=${latestIndicatorEvidence.id}`, "baseline=deviant-refined-baseline-v1.pine"] : []),
    ],
    blockedReason: observerOnline ? null : "No current Local Agent observation is available.",
  });
  await emitHandoff("OBSERVER", "SUPERVISOR", "TRADING", tradingResult);

  // Deal Finder: criteria live in Dwight's browser and no property data source is connected yet.
  tasks = updateTask(tasks, dealTaskResult.task.id, { status: "RUNNING", result: null, blockedReason: null });
  const dealResult = "Not searching yet: deal criteria are only saved in the browser and no property listing data source is connected.";
  agents = setAgent(agents, "DEAL_FINDER", {
    status: "BLOCKED",
    lastRanAt: now,
    lastResult: dealResult,
    currentWork: "Waiting for criteria to sync to Jarvis and a property data source, then search target areas and rank deals.",
  });
  tasks = updateTask(tasks, dealTaskResult.task.id, {
    status: "BLOCKED",
    result: dealResult,
    evidence: ["criteriaStore=browser-only", "propertyDataSource=none"],
    blockedReason: "Needs deal criteria stored in Jarvis and a property data source.",
  });
  await emitHandoff("DEAL FINDER", "SUPERVISOR", "SENTRYOPS", dealResult);

  // Finance data still refreshes in the background for the Finance page (no agent lane).
  const financeRefresh = plaidFinanceConfigured() ? await refreshFinanceFromPlaid().catch(() => null) : null;
  const finance = financeRefresh?.state ?? await getOrSeedFinanceState();

  // Supervisor's measured system checks; evidence lines prefixed "check:" are machine-verified.
  const integrationRegistry = await getJarvisIntegrationRegistry();
  const [infra, security, integrations] = await Promise.all([
    infrastructureCheck().catch((error) => ({ ok: false, degraded: true, summary: "Infrastructure check crashed: " + (error instanceof Error ? error.message : "unknown"), findings: [], evidence: ["check:infra=crashed"] })),
    Promise.resolve(securityCheck()),
    integrationsCheck().catch((error) => ({ ok: false, degraded: true, summary: "Integration check crashed: " + (error instanceof Error ? error.message : "unknown"), findings: [], evidence: ["check:integrations=crashed"] })),
  ]);
  const systemChecks = [infra, security, integrations];
  const systemDegraded = systemChecks.filter((check) => check.degraded);

  const executed = await executeQueuedTasks(tasks, agents, now);
  tasks = executed.tasks;
  agents = executed.agents;

  tasks = applyTruthVerification(tasks, now);
  tasks = updateTask(tasks, supervisorTaskResult.task.id, { status: "RUNNING", result: null, blockedReason: null });
  const qa = auditCycle(
    agents,
    tasks,
    previous.objectives.find((objective) => objective.status === "ACTIVE") ?? null,
  );
  const systemSummary = systemDegraded.length
    ? `System checks degraded: ${systemDegraded.map((check) => check.summary).join(" ")}`
    : "System checks passed (infrastructure, security, integrations).";
  const supervisorErrored = qa.hasErrors || systemDegraded.length > 0;
  const supervisorSummary = `${qa.summary} ${systemSummary}`;
  tasks = updateTask(tasks, supervisorTaskResult.task.id, {
    status: supervisorErrored ? "FAILED" : "DONE",
    result: supervisorSummary,
    evidence: [...qa.evidence, ...systemChecks.flatMap((check) => check.evidence)],
    blockedReason: supervisorErrored
      ? [qa.hasErrors ? "At least one agent reported an error." : null, ...systemDegraded.flatMap((check) => check.findings.length ? check.findings : [check.summary])].filter(Boolean).join(" ")
      : null,
  });
  tasks = applyTruthVerification(tasks, now);

  const executiveSummary = synthesizeExecutiveSummary({
    tradingResult,
    dealResult,
    supervisorSummary,
  });
  tasks = pruneTasks(tasks);
  const executiveFocus = chooseExecutiveFocus(tasks);
  const operatingSystem = buildOperatingSystem({
    previous,
    agents,
    tasks,
    executiveFocus,
    finance,
    tradingRuntime,
    integrationRegistry,
  });

  agents = setAgent(agents, "SUPERVISOR", {
    status: supervisorErrored ? "ERROR" : "DONE",
    lastRanAt: now,
    lastResult: supervisorSummary.slice(0, 600),
    currentWork: operatingSystem.chiefOfStaff.highestLeverage,
  });
  const hasErrors = agents.some((agent) => agent.status === "ERROR");
  const hasBlockers = agents.some((agent) => agent.status === "BLOCKED");

  const next: WorkforceState = {
    version: 1,
    cycleId,
    lastCycleAt: now,
    status: hasErrors || hasBlockers ? "DEGRADED" : "ACTIVE",
    agents,
    objectives: previous.objectives,
    tasks,
    executiveSummary,
    operatingSystem,
  };

  await setWorkforceState(next);
  await appendRuntimeEvent(
    createRuntimeEvent({
      type: "workforce.cycle_completed",
      domain: "CORE",
      source: "jarvis.workforce",
      importance: hasErrors || hasBlockers ? "IMPORTANT" : "NORMAL",
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
  const source = input.source?.trim().slice(0, 120) || "jarvis.executive";
  const allowed = permissionWithinCeiling(permissionRequired, agent?.permissionCeiling ?? "READ");
  const governance = classifyTaskGovernance({
    title: input.title,
    domain: input.domain ?? agent?.domain ?? "CORE",
    assignedTo,
    priority: input.priority ?? "MEDIUM",
    permissionRequired,
    objectiveId: input.objectiveId ?? null,
    source,
  });
  const status: AgentTask["status"] =
    governance.action === "BLOCKED" ? "BLOCKED" :
    governance.action === "WAIT_FOR_DWIGHT" || !allowed ? "WAITING_APPROVAL" :
    "QUEUED";
  const blockedReason =
    governance.action === "BLOCKED" || governance.action === "WAIT_FOR_DWIGHT"
      ? governance.reason
      : !allowed
        ? `Task requires ${permissionRequired}, above ${assignedTo}'s ${agent?.permissionCeiling ?? "READ"} permission ceiling.`
        : null;

  const task: AgentTask = {
    id: crypto.randomUUID(),
    title: input.title.trim().slice(0, 220),
    domain: input.domain ?? agent?.domain ?? "CORE",
    assignedTo,
    status,
    priority: input.priority ?? "MEDIUM",
    permissionRequired,
    createdAt: now,
    updatedAt: now,
    objectiveId: input.objectiveId ?? null,
    source,
    result: null,
    evidence: [],
    blockedReason,
    definitionOfDone: defaultDefinitionOfDone({
      title: input.title,
      assignedTo,
      domain: input.domain ?? agent?.domain ?? "CORE",
    }),
    governance,
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
      summary: `${task.assignedTo} assigned: ${task.title}${task.status === "WAITING_APPROVAL" ? " · approval required" : task.status === "BLOCKED" ? " · blocked by governance" : task.governance?.action === "USER_AUTHORIZED" ? " · Dwight-authorized" : ""}`,
    }),
  );

  return task;
}

function mergeMissingAgents(existing: AgentState[]) {
  return DEFAULT_AGENTS.map((fallback) => existing.find((agent) => agent.id === fallback.id) ?? fallback);
}

function mergeMissingObjectives(existing: WorkforceObjective[]) {
  const current = existing.filter((objective) => !RETIRED_OBJECTIVE_IDS.has(objective.id));
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
    (task.source === "workforce.cycle"
      ? ["QUEUED", "RUNNING", "BLOCKED", "FAILED", "DONE"].includes(task.status)
      : ["QUEUED", "RUNNING", "BLOCKED"].includes(task.status)),
  );
  if (existing) return { tasks, task: existing };

  const now = new Date().toISOString();
  const governance = classifyTaskGovernance(seed);
  const task: AgentTask = {
    id: crypto.randomUUID(),
    ...seed,
    status:
      governance.action === "BLOCKED" ? "BLOCKED" :
      governance.action === "WAIT_FOR_DWIGHT" ? "WAITING_APPROVAL" :
      "QUEUED",
    createdAt: now,
    updatedAt: now,
    result: null,
    evidence: [],
    blockedReason:
      governance.action === "BLOCKED" || governance.action === "WAIT_FOR_DWIGHT"
        ? governance.reason
        : null,
    definitionOfDone: seed.definitionOfDone?.trim() || defaultDefinitionOfDone(seed),
    governance,
  };
  return { tasks: [task, ...tasks], task };
}

function updateTask(tasks: AgentTask[], id: string, patch: Partial<AgentTask>) {
  const updatedAt = new Date().toISOString();
  return tasks.map((task) => task.id === id ? { ...task, ...patch, updatedAt } : task);
}

function pruneTasks(tasks: AgentTask[]) {
  // Each scheduled check represents one continuing responsibility, not a new
  // employee assignment every time an unchanged dependency fails.
  // Keep the latest result (including FAILED), then retry/update it in place.
  const recurringKeys = new Set<string>();
  const sorted = [...tasks].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const unique = sorted.filter((task) => {
    if (task.source !== "workforce.cycle") return true;
    const key = [task.source, task.assignedTo, task.domain, task.title].join("|");
    if (recurringKeys.has(key)) return false;
    recurringKeys.add(key);
    return true;
  });
  const openStatuses: AgentTask["status"][] = ["QUEUED", "RUNNING", "BLOCKED", "WAITING_APPROVAL"];
  const open = unique.filter((task) => openStatuses.includes(task.status));
  const closed = unique.filter((task) => !openStatuses.includes(task.status)).slice(0, 70);
  return [...open, ...closed].slice(0, 100);
}

function defaultAgentForDomain(domain: AgentTask["domain"]): AgentId {
  if (domain === "SENTRYOPS") return "DEAL_FINDER";
  if (domain === "TRADING") return "TRADING_OBSERVER";
  return "SUPERVISOR";
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

function classifyTaskGovernance(input: {
  title: string;
  domain?: AgentTask["domain"];
  assignedTo?: AgentId;
  priority?: AgentTaskPriority;
  permissionRequired?: AgentPermission;
  objectiveId?: string | null;
  source?: string;
}): WorkforceGovernanceDecision {
  const title = input.title.toLowerCase();
  const source = (input.source ?? "").toLowerCase();
  const userAuthorized = source === "jarvis.workforce.ui" || source === "jarvis.chat" || source.startsWith("dwight.");
  const evaluatedAt = new Date().toISOString();

  const hardLimit = /\b(live trade|place (?:a )?(?:trade|order)|execute (?:a )?trade|unrestricted money movement|transfer (?:money|funds)|bypass (?:an? )?approval|disable (?:a )?guardrail|expose (?:a )?secret|reveal (?:an? )?(?:api key|password|credential)|expand (?:my|its|agent) permissions?|change (?:its|own) governance)\b/i.test(title);
  if (hardLimit) {
    return {
      risk: "CRITICAL",
      scope: "EXPAND",
      action: "BLOCKED",
      reason: "Hard autonomy boundary: this action stays disabled until Dwight deliberately changes the governing capability and its safety controls.",
      evaluatedAt,
    };
  }

  const consequentialExternal =
    input.permissionRequired === "REQUIRES_APPROVAL" ||
    input.permissionRequired === "EXTERNAL_LOW_RISK" ||
    /\b(spend|purchase|pay|contract|sign|publish|contact|email|message|production deploy|deploy to production|delete production|credential|secret|permission change|account change)\b/i.test(title);
  if (consequentialExternal) {
    return {
      risk: input.priority === "CRITICAL" ? "CRITICAL" : "HIGH",
      scope: "EXECUTE",
      action: "WAIT_FOR_DWIGHT",
      reason: "Consequential external, financial, production, or permission-changing action requires Dwight's approval before execution.",
      evaluatedAt,
    };
  }

  const architectureChange = /\b(redesign|rebuild|rearchitect|re-architect|rewrite|replace architecture|migrate architecture|new architecture)\b/i.test(title);
  const expansion = architectureChange || /\b(new (?:feature|capability|integration|agent|mission)|add (?:a |an )?(?:feature|capability|integration|agent)|expand (?:the )?(?:mission|scope|platform|workforce))\b/i.test(title);

  if (architectureChange && !userAuthorized) {
    return {
      risk: "HIGH",
      scope: "EXPAND",
      action: "WAIT_FOR_DWIGHT",
      reason: "Controlled-aggression boundary: material redesign requires Dwight. First reproduce the problem, prove the current architecture cannot be corrected surgically, and show the expected gain versus blast radius.",
      evaluatedAt,
    };
  }

  if (expansion && !userAuthorized && !input.objectiveId) {
    return {
      risk: "MEDIUM",
      scope: "EXPAND",
      action: "WAIT_FOR_DWIGHT",
      reason: "This expands scope outside an approved objective. Preserve the idea, but do not convert vision into execution until Dwight expands the mission.",
      evaluatedAt,
    };
  }

  if (userAuthorized) {
    return {
      risk: architectureChange ? "HIGH" : expansion ? "MEDIUM" : "LOW",
      scope: expansion ? "EXPAND" : "EXECUTE",
      action: "USER_AUTHORIZED",
      reason: "Dwight directly authorized this internal work. Normal QA, evidence, rollback, and permission boundaries still apply.",
      evaluatedAt,
    };
  }

  const maintenance = /\b(test|verify|validate|monitor|audit|document|cleanup|clean up|reproduce|review|research|analyze|inspect|retry|recover|repair|fix|check|backup)\b/i.test(title);
  return {
    risk: maintenance ? "LOW" : input.priority === "CRITICAL" ? "HIGH" : "MEDIUM",
    scope: maintenance ? "MAINTAIN" : "EXECUTE",
    action: "AUTO_PROCEED",
    reason: maintenance
      ? "Low-risk, reversible mission maintenance may proceed autonomously and should be completed without unnecessary escalation."
      : "Work stays inside the approved mission and permission ceiling. Execute decisively, use the smallest effective move, measure the result, and require definition-of-done plus QA before claiming success.",
    evaluatedAt,
  };
}

function defaultDefinitionOfDone(input: { title: string; assignedTo?: string; domain?: string }) {
  const title = input.title.trim().replace(/\.$/, "");
  return [
    title + " is complete only when the intended outcome is observable",
    "supporting evidence is attached or referenced",
    "known blockers are resolved or explicitly escalated",
    "and QA can independently verify the result without relying on the agent's claim.",
  ].join(", ") + ".";
}

/**
 * Honest proof states:
 * - VERIFIED: the outcome rests on a measured machine check (evidence "check:…").
 * - OBSERVED: grounded in tool output or recorded evidence, but not machine-verified.
 * - CLAIMED: completion without evidence.
 */
function applyTruthVerification(tasks: AgentTask[], checkedAt: string) {
  return tasks.map((task) => {
    if (task.status !== "DONE") {
      if (task.status === "FAILED" && task.result) {
        return {
          ...task,
          verification: {
            state: "DISPUTED" as const,
            checkedBy: "SUPERVISOR" as const,
            checkedAt,
            rationale: "The outcome did not complete cleanly; the result is kept as failure evidence, not success.",
            evidenceCount: task.evidence.length,
          },
        };
      }
      return task;
    }

    const evidence = task.evidence.filter((item) => item.trim().length > 0);
    const measured = evidence.some((item) => item.startsWith("check:"));
    const hasResult = Boolean(task.result?.trim());
    const state =
      measured && hasResult ? "VERIFIED" as const :
      evidence.length > 0 && hasResult ? "OBSERVED" as const :
      "CLAIMED" as const;
    const checkedBy = "SUPERVISOR" as const;

    return {
      ...task,
      verification: {
        state,
        checkedBy,
        checkedAt,
        rationale:
          state === "VERIFIED"
            ? "Outcome rests on a measured machine check recorded as evidence."
            : state === "OBSERVED"
              ? "Outcome is grounded in tool output or recorded evidence, but no machine check confirms it."
              : "Completion was reported without evidence; treat it as a claim.",
        evidenceCount: evidence.length,
      },
    };
  });
}

/** Share of recent completions that are grounded (VERIFIED or OBSERVED), used for unattended readiness. */
function groundedRate(tasks: AgentTask[]) {
  const done = tasks.filter((task) => task.status === "DONE");
  if (!done.length) return 100;
  const grounded = done.filter((task) => task.verification?.state === "VERIFIED" || task.verification?.state === "OBSERVED").length;
  return Math.round((grounded / done.length) * 100);
}

function riskRank(value: WorkforceGap["risk"]) {
  return value === "CRITICAL" ? 4 : value === "HIGH" ? 3 : value === "MEDIUM" ? 2 : 1;
}

function buildTruthLayer(tasks: AgentTask[]): WorkforceOperatingSystem["truth"] {
  const completed = tasks
    .filter((task) => task.status === "DONE")
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const stateOf = (task: AgentTask) => task.verification?.state ?? (task.evidence.length ? "OBSERVED" as const : "CLAIMED" as const);
  const verified = completed.filter((task) => stateOf(task) === "VERIFIED").length;
  const observed = completed.filter((task) => stateOf(task) === "OBSERVED").length;
  const claimed = completed.filter((task) => stateOf(task) === "CLAIMED").length;
  const disputed = tasks.filter((task) => task.verification?.state === "DISPUTED").length;
  const verificationRate = completed.length ? Math.round((verified / completed.length) * 100) : 100;

  return {
    verified,
    observed,
    claimed,
    disputed,
    verificationRate,
    recent: completed.slice(0, 10).map((task) => ({
      taskId: task.id,
      title: task.title,
      state: stateOf(task),
      checkedBy: task.verification?.checkedBy ?? null,
      rationale: task.verification?.rationale ?? "No verifier rationale recorded yet.",
      evidenceCount: task.verification?.evidenceCount ?? task.evidence.length,
      updatedAt: task.updatedAt,
    })),
  };
}

function buildWorldState(input: {
  agents: AgentState[];
  executiveFocus: string;
  finance?: Awaited<ReturnType<typeof getOrSeedFinanceState>>;
  sentryPulse?: NonNullable<Awaited<ReturnType<typeof getLatestPulse>>>;
  tradingRuntime?: Awaited<ReturnType<typeof getTradingState>>;
  now: string;
}): WorkforceOperatingSystem["worldState"] {
  const coreAgents = input.agents.filter((agent) => agent.domain === "CORE");
  const coreError = coreAgents.some((agent) => agent.status === "ERROR");
  const coreBlocked = coreAgents.some((agent) => agent.status === "BLOCKED");
  const tradingConnection = input.tradingRuntime?.account.connection;
  const observedAt = input.tradingRuntime?.observer?.observedAt ?? input.tradingRuntime?.account.lastObservedAt ?? input.now;

  return {
    asOf: input.now,
    mission: input.executiveFocus,
    domains: [
      {
        domain: "CORE",
        status: coreError ? "DEGRADED" : coreBlocked ? "BLOCKED" : "HEALTHY",
        truth: coreError ? "DISPUTED" : "VERIFIED",
        summary: coreError
          ? "One or more core agents reported an error."
          : coreBlocked
            ? "Core operations are live with at least one blocked dependency."
            : "Core workforce, governance, and runtime checks are operating without a reported core error.",
        source: "workforce.agent-health",
        asOf: input.now,
      },
      {
        domain: "FINANCE",
        status: input.finance ? "HEALTHY" : "UNKNOWN",
        truth: input.finance ? (input.finance.mode === "DIRECT" ? "VERIFIED" : "OBSERVED") : "CLAIMED",
        summary: input.finance
          ? `${input.finance.mode} finance state · liquidity ${input.finance.metrics.liquidity.toFixed(2)} · personal debt ${input.finance.metrics.personalDebt.toFixed(2)}.`
          : "Finance runtime has not been loaded into this bootstrap operating picture.",
        source: input.finance?.source ?? "finance.runtime",
        asOf: input.finance?.asOf ?? input.now,
      },
      {
        domain: "SENTRYOPS",
        status: "BLOCKED",
        truth: "OBSERVED",
        summary: "Real Estate: Deal Finder is waiting for criteria stored in Jarvis and a property data source.",
        source: "workforce.deal-finder",
        asOf: input.now,
      },
      {
        domain: "TRADING",
        status: !input.tradingRuntime ? "UNKNOWN" : tradingConnection === "OBSERVING" ? "HEALTHY" : tradingConnection === "DEGRADED" ? "DEGRADED" : "BLOCKED",
        truth: input.tradingRuntime?.observer?.observedAt ? "OBSERVED" : "CLAIMED",
        summary: input.tradingRuntime
          ? `Observer connection ${tradingConnection}. Latest symbol ${input.tradingRuntime.observer?.symbol ?? "none"}; state ${input.tradingRuntime.observer?.status ?? "UNKNOWN"}.`
          : "Trading runtime is not loaded into this bootstrap operating picture.",
        source: "trading.observer",
        asOf: observedAt,
      },
      {
        domain: "LIFE",
        status: "UNKNOWN",
        truth: "CLAIMED",
        summary: "Life remains a user-facing domain without a server-side telemetry feed in the workforce cycle. JARVIS will not invent live status.",
        source: "life.no-live-feed",
        asOf: input.now,
      },
    ],
  };
}

function buildScenarioBook(input: {
  finance?: Awaited<ReturnType<typeof getOrSeedFinanceState>>;
  sentryPulse?: NonNullable<Awaited<ReturnType<typeof getLatestPulse>>>;
  integrationRegistry?: Awaited<ReturnType<typeof getJarvisIntegrationRegistry>>;
}): WorkforceOperatingSystem["scenarios"] {
  const degraded = input.integrationRegistry?.filter((item) => item.state === "DEGRADED") ?? [];
  const liquidity = input.finance?.metrics.liquidity ?? null;
  const debt = input.finance?.metrics.personalDebt ?? null;
  return [
    {
      id: "scenario-provider-outage",
      title: "Critical provider or integration outage",
      trigger: degraded.length ? `Active degradation detected: ${degraded.map((item) => item.label).join(", ")}.` : "A critical runtime, data, or integration provider becomes unavailable.",
      impact: "Agent evidence can go stale, automation can stall, and false-success risk rises if the system keeps acting as though the provider is healthy.",
      response: "Degrade explicitly, preserve durable state, queue retryable work, isolate the failed dependency, and escalate only the action that requires executive authority.",
      owner: "SUPERVISOR",
      status: degraded.length ? "ACTIVE" : "WATCH",
    },
    {
      id: "scenario-deal-data-gap",
      title: "Deal Finder has no data to search",
      trigger: "Criteria are not stored in Jarvis or no property listing source is connected.",
      impact: "No deals reach the pipeline, so good flips in the target areas are missed.",
      response: "Sync criteria to Jarvis, connect a listing data source, then search, score and rank deals each cycle.",
      owner: "DEAL_FINDER",
      status: "ACTIVE",
    },
    {
      id: "scenario-cashflow-shock",
      title: "Variable income pauses while obligations continue",
      trigger: "Trading or other variable cash inflow pauses for a sustained period.",
      impact: liquidity === null || debt === null
        ? "Finance state is unavailable, so JARVIS cannot quantify the immediate capital pressure."
        : `Current runtime shows ${liquidity.toFixed(2)} liquidity and ${debt.toFixed(2)} personal debt; a cash-flow pause would increase the importance of liquidity discipline and high-ROI deployment.`,
      response: "Preserve required liquidity, avoid unmeasured expansion, prioritize obligations and the highest-evidence cash-generating work, then re-open discretionary deployment as the operating picture improves.",
      owner: "SUPERVISOR",
      status: debt !== null && liquidity !== null && debt > liquidity ? "ACTIVE" : "WATCH",
    },
  ];
}

function buildOpportunityBook(
  pulse: NonNullable<Awaited<ReturnType<typeof getLatestPulse>>> | undefined,
  previous: WorkforceOperatingSystem["opportunities"],
  now: string,
): WorkforceOperatingSystem["opportunities"] {
  const current = (pulse?.opportunities ?? []).map((item) => ({
    id: `sentry:${item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72)}`,
    title: item.title,
    domain: "SENTRYOPS" as const,
    priority: item.priority,
    status: item.priority === "HIGH" ? "VALIDATE" as const : "WATCH" as const,
    whyItMatters: item.whyItMatters,
    evidence: item.evidence,
    nextAction: pulse?.nextMove.title ?? "Validate the signal against a second source and a concrete buyer/problem path.",
    updatedAt: pulse?.ranAt ?? now,
  }));
  const currentIds = new Set(current.map((item) => item.id));
  const carry = previous
    .filter((item) => !currentIds.has(item.id) && item.status !== "REJECTED")
    .map((item) => ({ ...item, status: "WATCH" as const }))
    .slice(0, 6);
  return [...current, ...carry].slice(0, 12);
}

function buildOperatingMetrics(
  tasks: AgentTask[],
  gaps: WorkforceGap[],
  opportunities: WorkforceOperatingSystem["opportunities"],
): WorkforceOperatingSystem["metrics"] {
  const now = Date.now();
  const done = tasks.filter((task) => task.status === "DONE");
  const verified = done.filter((task) => task.verification?.state === "VERIFIED");
  const autonomousDone = done.filter((task) => task.governance?.action === "AUTO_PROCEED");
  const open = tasks.filter((task) => ["QUEUED", "RUNNING", "BLOCKED", "WAITING_APPROVAL"].includes(task.status));
  const stale = open.filter((task) => Number.isFinite(Date.parse(task.updatedAt)) && now - Date.parse(task.updatedAt) > 24 * 60 * 60 * 1000);
  const closedLast24h = tasks.filter((task) =>
    ["DONE", "FAILED"].includes(task.status) &&
    Number.isFinite(Date.parse(task.updatedAt)) &&
    now - Date.parse(task.updatedAt) <= 24 * 60 * 60 * 1000
  ).length;
  return {
    verificationRate: done.length ? Math.round((verified.length / done.length) * 100) : 100,
    autonomousCompletionRate: done.length ? Math.round((autonomousDone.length / done.length) * 100) : 0,
    openLoops: open.length,
    staleOpenTasks: stale.length,
    waitingOnDwight: open.filter((task) => task.status === "WAITING_APPROVAL").length,
    closedLast24h,
    activeGaps: gaps.filter((gap) => gap.status !== "RESOLVED").length,
    activeOpportunities: opportunities.filter((item) => item.status !== "REJECTED").length,
  };
}

function buildDecisionMemory(input: {
  previous: WorkforceOperatingSystem["decisionMemory"];
  now: string;
  executiveFocus: string;
  expansionGate: boolean;
  avoidanceGap: WorkforceGap | undefined;
  truthRate: number;
  activeOpportunities: number;
  activeObjectiveId: string | null;
}): WorkforceOperatingSystem["decisionMemory"] {
  const last = input.previous[0];
  if (last?.decision === input.executiveFocus) return input.previous.slice(0, 40);
  const reason = input.expansionGate && input.avoidanceGap
    ? `A ${input.avoidanceGap.risk.toLowerCase()} unresolved gap is constraining clean expansion: ${input.avoidanceGap.title}.`
    : "The operating picture does not show a higher-risk unresolved gap, so the executive lane can advance the highest-leverage objective.";
  const record = {
    id: crypto.randomUUID(),
    at: input.now,
    owner: "SUPERVISOR" as const,
    decision: input.executiveFocus,
    reason,
    expectedOutcome: input.expansionGate && input.avoidanceGap
      ? input.avoidanceGap.definitionOfDone
      : "Move the approved mission forward, attach evidence, and re-evaluate on the next cycle.",
    evidence: [
      `truthVerificationRate=${input.truthRate}%`,
      `activeOpportunities=${input.activeOpportunities}`,
      input.avoidanceGap ? `topGap=${input.avoidanceGap.id}` : "topGap=none",
    ],
    objectiveId: input.activeObjectiveId,
  };
  return [record, ...input.previous].slice(0, 40);
}

function buildContinuity(input: {
  previous: WorkforceState | null;
  agents: AgentState[];
  tasks: AgentTask[];
  gaps: WorkforceGap[];
  truthRate: number;
}): WorkforceOperatingSystem["continuity"] {
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const recent = input.tasks.filter(task =>
    Number.isFinite(Date.parse(task.updatedAt)) &&
    now - Date.parse(task.updatedAt) <= sevenDays
  );
  const open = input.tasks.filter(task => ["QUEUED", "RUNNING", "BLOCKED", "WAITING_APPROVAL"].includes(task.status));
  const stale = open.filter(task =>
    Number.isFinite(Date.parse(task.updatedAt)) &&
    now - Date.parse(task.updatedAt) > 24 * 60 * 60 * 1000
  );
  const criticalGaps = input.gaps.filter(gap => gap.status !== "RESOLVED" && gap.risk === "CRITICAL");
  const failed = recent.filter(task => task.status === "FAILED");
  const approvals = open.filter(task => task.status === "WAITING_APPROVAL");
  const agentErrors = input.agents.filter(agent => agent.status === "ERROR");

  const executiveExceptions: WorkforceOperatingSystem["continuity"]["executiveExceptions"] = [
    ...approvals.slice(0, 5).map(task => ({
      type: "APPROVAL" as const,
      title: task.title,
      owner: "SUPERVISOR" as const,
      reason: task.blockedReason ?? "This action is approval-gated.",
    })),
    ...criticalGaps.slice(0, 5).map(gap => ({
      type: "CRITICAL_GAP" as const,
      title: gap.title,
      owner: gap.owner,
      reason: gap.definitionOfDone,
    })),
    ...failed.slice(0, 5).map(task => ({
      type: "FAILED_WORK" as const,
      title: task.title,
      owner: task.assignedTo,
      reason: task.blockedReason ?? task.result ?? "The task failed and requires recovery.",
    })),
    ...stale.slice(0, 5).map(task => ({
      type: "STALE_WORK" as const,
      title: task.title,
      owner: task.assignedTo,
      reason: "Open work has not moved for more than 24 hours.",
    })),
  ].slice(0, 12);

  const blockingReasons: string[] = [];
  if (!input.previous?.autonomy?.enabled) blockingReasons.push("Durable 24/7 workforce is not currently enabled.");
  if (agentErrors.length) blockingReasons.push(`${agentErrors.length} agent error${agentErrors.length === 1 ? "" : "s"} remain unresolved.`);
  if (criticalGaps.length) blockingReasons.push(`${criticalGaps.length} critical gap${criticalGaps.length === 1 ? "" : "s"} remain open.`);
  if (stale.length) blockingReasons.push(`${stale.length} open task${stale.length === 1 ? "" : "s"} have been stale for more than 24 hours.`);
  if (input.truthRate < 90) blockingReasons.push(`Only ${input.truthRate}% of recorded completions are grounded in checks or tool evidence; unattended operation requires at least 90%.`);

  const closed = recent.filter(task => ["DONE", "FAILED"].includes(task.status)).length;
  const verified = recent.filter(task => task.status === "DONE" && task.verification?.state === "VERIFIED").length;
  const autonomous = recent.filter(task => task.status === "DONE" && task.governance?.action === "AUTO_PROCEED").length;

  return {
    unattendedReady: blockingReasons.length === 0,
    blockingReasons,
    last7Days: {
      closed,
      failed: failed.length,
      verified,
      autonomous,
      escalations: approvals.length,
    },
    executiveExceptions,
    whileAwayBrief: blockingReasons.length
      ? `Unattended operation is not yet clean: ${blockingReasons.join(" ")} Routine work may continue within the autonomy charter, but these exceptions should remain visible to Dwight.`
      : `Unattended operation is structurally ready from the current workforce evidence. In the last 7 days JARVIS closed ${closed} outcomes, independently verified ${verified}, completed ${autonomous} autonomously, and has ${approvals.length} approval exception${approvals.length === 1 ? "" : "s"} waiting on Dwight.`,
  };
}

function buildOperatingSystem(input: {
  previous: WorkforceState | null;
  agents: AgentState[];
  tasks: AgentTask[];
  executiveFocus: string;
  finance?: Awaited<ReturnType<typeof getOrSeedFinanceState>>;
  sentryPulse?: NonNullable<Awaited<ReturnType<typeof getLatestPulse>>>;
  tradingRuntime?: Awaited<ReturnType<typeof getTradingState>>;
  integrationRegistry?: Awaited<ReturnType<typeof getJarvisIntegrationRegistry>>;
}): WorkforceOperatingSystem {
  const now = new Date().toISOString();
  const prior = input.previous?.operatingSystem?.gaps ?? [];
  const gaps = new Map<string, WorkforceGap>();

  for (const gap of prior) {
    if (gap.status === "RESOLVED") gaps.set(gap.id, gap);
  }

  for (const agent of input.agents) {
    if (agent.status !== "ERROR" && agent.status !== "BLOCKED") continue;
    const id = `agent:${agent.id.toLowerCase()}`;
    gaps.set(id, {
      id,
      title: `${agent.id} operational gap: ${agent.currentWork}`.slice(0, 220),
      risk: agent.status === "ERROR" ? "HIGH" : "MEDIUM",
      owner: agent.id,
      status: "ACTIVE",
      definitionOfDone: `${agent.id} returns to a verified non-error state and QA confirms the dependency or failure path is closed.`,
      source: "agent-health",
      updatedAt: now,
    });
  }

  for (const task of input.tasks) {
    if (!["BLOCKED", "FAILED", "WAITING_APPROVAL"].includes(task.status)) continue;
    const owner = task.status === "WAITING_APPROVAL" ? "SUPERVISOR" as const : task.assignedTo;
    const id = `task:${task.id}`;
    gaps.set(id, {
      id,
      title: task.title,
      risk: task.priority === "CRITICAL" ? "CRITICAL" : task.priority === "HIGH" ? "HIGH" : "MEDIUM",
      owner,
      status: "ACTIVE",
      definitionOfDone: task.definitionOfDone?.trim() || defaultDefinitionOfDone(task),
      source: task.status === "WAITING_APPROVAL" ? "approval" : "task",
      updatedAt: task.updatedAt || now,
    });
  }

  const gapList = [...gaps.values()]
    .sort((a, b) => riskRank(b.risk) - riskRank(a.risk) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 24);

  const open = input.tasks.filter((task) => ["QUEUED", "RUNNING", "BLOCKED", "WAITING_APPROVAL"].includes(task.status));
  const meaningful = open.filter((task) =>
    task.priority === "HIGH" ||
    task.priority === "CRITICAL" ||
    Boolean(task.objectiveId),
  );
  const blocked = open.filter((task) => task.status === "BLOCKED");
  const waiting = open.filter((task) => task.status === "WAITING_APPROVAL");
  const killCandidates = open.filter((task) =>
    !task.objectiveId &&
    (task.priority === "LOW" || task.priority === "MEDIUM") &&
    Number.isFinite(Date.parse(task.updatedAt)) &&
    Date.now() - Date.parse(task.updatedAt) > 24 * 60 * 60 * 1000,
  );
  const unresolved = gapList.filter((gap) => gap.status !== "RESOLVED");
  const expansionGate = unresolved.some((gap) => gap.risk === "CRITICAL" || gap.risk === "HIGH");
  const avoidanceGap = unresolved[0];
  const truth = buildTruthLayer(input.tasks);
  const opportunities = buildOpportunityBook(input.sentryPulse, input.previous?.operatingSystem?.opportunities ?? [], now);
  const scenarios = buildScenarioBook({
    finance: input.finance,
    sentryPulse: input.sentryPulse,
    integrationRegistry: input.integrationRegistry,
  });
  const worldState = buildWorldState({
    agents: input.agents,
    executiveFocus: input.executiveFocus,
    finance: input.finance,
    sentryPulse: input.sentryPulse,
    tradingRuntime: input.tradingRuntime,
    now,
  });
  const metrics = buildOperatingMetrics(input.tasks, gapList, opportunities);
  const decisionMemory = buildDecisionMemory({
    previous: input.previous?.operatingSystem?.decisionMemory ?? [],
    now,
    executiveFocus: input.executiveFocus,
    expansionGate,
    avoidanceGap,
    truthRate: truth.verificationRate,
    activeOpportunities: opportunities.filter((item) => item.status !== "REJECTED").length,
    activeObjectiveId: input.previous?.objectives.find((objective) => objective.status === "ACTIVE")?.id ?? null,
  });
  const financeLiquidity = input.finance?.metrics.liquidity ?? 0;
  const financeDebt = input.finance?.metrics.personalDebt ?? 0;
  const continuity = buildContinuity({
    previous: input.previous,
    agents: input.agents,
    tasks: input.tasks,
    gaps: gapList,
    truthRate: groundedRate(input.tasks),
  });

  return {
    doctrine: OPERATING_DOCTRINE,
    gaps: gapList,
    boringQueue: BORING_WORK,
    governance: BALANCED_GOVERNANCE,
    truth,
    worldState,
    decisionMemory,
    scenarios,
    opportunities,
    metrics,
    capitalDesk: {
      asOf: input.finance?.asOf ?? now,
      mode: "CONTROLLED_AGGRESSION",
      liquidity: financeLiquidity,
      personalDebt: financeDebt,
      currentStage: input.finance?.currentStage ?? "Finance runtime not loaded in this bootstrap state.",
      constraint: input.finance
        ? financeDebt > 0
          ? "Personal debt remains an active claim on capital. Every deployment should be compared against debt reduction, required liquidity, and expected strategic return."
          : "No personal debt pressure is present in the current runtime snapshot. Preserve required liquidity and deploy capital only against evidence-backed objectives."
        : "Live finance state is not loaded in this bootstrap state; do not invent deployable capital.",
      nextMove: input.finance ? financeDirective(input.finance) : "Load the finance runtime before making a capital-allocation call.",
    },
    continuity,
    chiefOfStaff: {
      meaningfulTasks: meaningful.length,
      blockedTasks: blocked.length,
      killCandidates: killCandidates.length,
      waitingOnDwight: waiting.length,
      highestLeverage: expansionGate && avoidanceGap
        ? `Close ${avoidanceGap.risk.toLowerCase()} gap first: ${avoidanceGap.title}`
        : input.executiveFocus,
      whatAvoiding: avoidanceGap
        ? `Unclosed loop: ${avoidanceGap.title}`
        : "No critical avoidance signal detected from current workforce evidence.",
    },
    execution: {
      expansionGate,
      currentFocus: expansionGate && avoidanceGap ? avoidanceGap.title : input.executiveFocus,
      nextAction: expansionGate && avoidanceGap
        ? avoidanceGap.definitionOfDone
        : "Advance the highest-leverage objective, then verify the result before adding scope.",
    },
  };
}

function auditCycle(agents: AgentState[], tasks: AgentTask[], objective: WorkforceObjective | null) {
  const failures = agents.filter((agent) => agent.status === "ERROR");
  const blockers = agents.filter((agent) => agent.status === "BLOCKED");
  const waitingApproval = tasks.filter((task) => task.status === "WAITING_APPROVAL");
  const running = tasks.filter((task) => task.status === "RUNNING");
  const openWithoutDone = tasks.filter(
    (task) =>
      ["QUEUED", "RUNNING", "BLOCKED", "WAITING_APPROVAL"].includes(task.status) &&
      !task.definitionOfDone?.trim(),
  );
  const governanceViolations = tasks.filter((task) =>
    (task.governance?.action === "BLOCKED" && !["BLOCKED", "FAILED"].includes(task.status)) ||
    (task.governance?.action === "WAIT_FOR_DWIGHT" && !["WAITING_APPROVAL", "BLOCKED", "FAILED"].includes(task.status)),
  );
  const recentUnverified = tasks.filter((task) =>
    task.status === "DONE" &&
    task.verification?.state === "CLAIMED" &&
    Number.isFinite(Date.parse(task.updatedAt)) &&
    Date.now() - Date.parse(task.updatedAt) <= 24 * 60 * 60 * 1000
  );
  const adversarialCheck = objective
    ? `Red-team pressure: prove the evidence behind "${objective.title}", name the dependency most likely to fail, preserve a rollback path, and do not confuse activity with the success definition.`
    : "Red-team pressure: challenge the highest-leverage assumption before expanding scope; require evidence, a measurable result, and a rollback path.";

  const evidence = [
    `errors=${failures.length}`,
    `blockedAgents=${blockers.length}`,
    `waitingApproval=${waitingApproval.length}`,
    `stillRunning=${running.length}`,
    `missingDefinitionOfDone=${openWithoutDone.length}`,
    `governanceViolations=${governanceViolations.length}`,
    `recentUnverified=${recentUnverified.length}`,
    `redTeam=${objective?.id ?? "core"}`,
  ];

  if (governanceViolations.length) {
    return {
      hasErrors: true,
      hasBlockers: true,
      summary: `QA found ${governanceViolations.length} governance violation${governanceViolations.length === 1 ? "" : "s"}. JARVIS stopped the clean-cycle claim because protected work crossed its allowed boundary.`,
      nextCheck: "Return protected work to WAITING_APPROVAL/BLOCKED, then re-run QA.",
      evidence,
      blockedReason: governanceViolations.map((task) => `${task.assignedTo}: ${task.title}`).join(" | "),
    };
  }

  if (recentUnverified.length) {
    return {
      hasErrors: false,
      hasBlockers: true,
      summary: `QA rejected ${recentUnverified.length} recent completion claim${recentUnverified.length === 1 ? "" : "s"} made without any evidence. ${adversarialCheck}`,
      nextCheck: "Attach evidence or restore the definition of done, then let QA re-check the completion claim.",
      evidence,
      blockedReason: recentUnverified.map((task) => `${task.assignedTo}: ${task.title} [${task.verification?.state ?? "CLAIMED"}]`).join(" | "),
    };
  }

  if (failures.length) {
    return {
      hasErrors: true,
      hasBlockers: blockers.length > 0,
      summary: `QA found ${failures.length} agent error${failures.length === 1 ? "" : "s"}: ${failures.map((agent) => agent.id).join(", ")}. JARVIS must not report a clean cycle. ${adversarialCheck}`,
      nextCheck: "Re-check failed agents after their provider or data dependency recovers.",
      evidence,
      blockedReason: failures.map((agent) => `${agent.id}: ${agent.lastResult}`).join(" | "),
    };
  }

  if (blockers.length || waitingApproval.length || openWithoutDone.length) {
    return {
      hasErrors: false,
      hasBlockers: true,
      summary: `QA found no agent errors, but ${blockers.length} agent${blockers.length === 1 ? "" : "s"} are blocked, ${waitingApproval.length} task${waitingApproval.length === 1 ? "" : "s"} await approval, and ${openWithoutDone.length} open task${openWithoutDone.length === 1 ? "" : "s"} lack a definition of done. ${adversarialCheck}`,
      nextCheck: "Watch blocked dependencies and surface approval requests without bypassing them.",
      evidence,
      blockedReason:
        blockers.map((agent) => `${agent.id}: ${agent.lastResult}`).join(" | ") ||
        (openWithoutDone.length ? "Open work is missing a definition of done." : "Approval-gated work is waiting."),
    };
  }

  return {
    hasErrors: false,
    hasBlockers: false,
    summary: `QA verified the cycle: no agent errors, no blocked agents, no hidden approval-gated work, and recent completion claims passed the proof-state check. ${adversarialCheck}`,
    nextCheck: "Continue checking evidence freshness and task outcomes on the next cycle.",
    evidence,
    blockedReason: null,
  };
}

async function emitHandoff(from: string, to: string, domain: AgentTask["domain"], summary: string) {
  const compact = summary.replace(/\s+/g, " ").trim().slice(0, 360);
  await appendRuntimeEvent(
    createRuntimeEvent({
      type: "workforce.handoff",
      domain,
      source: `jarvis.handoff.${from.toLowerCase()}.${to.toLowerCase()}`,
      importance: "NORMAL",
      summary: `${from} → ${to}: ${compact}`,
    }),
  );
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
  tradingResult: string;
  dealResult: string;
  supervisorSummary: string;
}) {
  return [
    `Trading Observer: ${input.tradingResult}`,
    `Deal Finder: ${input.dealResult}`,
    `Supervisor: ${input.supervisorSummary}`,
  ].join(" ").slice(0, 900);
}

function chooseExecutiveFocus(tasks: AgentTask[]) {
  const approvalTask = tasks.find((task) => task.status === "WAITING_APPROVAL");
  if (approvalTask) return `Review approval request: ${approvalTask.title}`;
  const highPriorityOpen = tasks.find((task) => ["QUEUED", "BLOCKED"].includes(task.status) && (task.priority === "CRITICAL" || task.priority === "HIGH"));
  if (highPriorityOpen) return `${highPriorityOpen.assignedTo}: ${highPriorityOpen.title}`;
  return "Keep the arrow indicator improving and the deal pipeline flowing while waiting for the next evidence-backed action.";
}


/* ------------------------------------------------------------------ */
/* Task execution and owner decisions                                   */
/* ------------------------------------------------------------------ */

const MAX_TASKS_PER_CYCLE = 2;
const PRIORITY_RANK: Record<AgentTaskPriority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/**
 * Runs queued, governance-cleared tasks (not the recurring cycle checks) through
 * the assigned agent. At most two per cycle so a cycle stays inside its time budget.
 */
async function executeQueuedTasks(tasks: AgentTask[], agents: AgentState[], now: string, onlyTaskId?: string): Promise<{ tasks: AgentTask[]; agents: AgentState[] }> {
  const runnable = tasks
    .filter((task) => onlyTaskId ? task.id === onlyTaskId : true)
    .filter((task) =>
      task.status === "QUEUED" &&
      (onlyTaskId !== undefined || task.source !== "workforce.cycle") &&
      (task.governance?.action === "AUTO_PROCEED" || task.governance?.action === "USER_AUTHORIZED"))
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .slice(0, MAX_TASKS_PER_CYCLE);

  let nextTasks = tasks;
  let nextAgents = agents;
  for (const task of runnable) {
    const agent = nextAgents.find((item) => item.id === task.assignedTo);
    if (!agent) continue;
    nextTasks = updateTask(nextTasks, task.id, { status: "RUNNING", blockedReason: null });
    nextAgents = setAgent(nextAgents, agent.id, { status: "RUNNING", currentWork: task.title });
    const context = [
      `Agent last result: ${agent.lastResult}`,
      `Other open tasks: ${nextTasks.filter((t) => ["QUEUED", "RUNNING", "WAITING_APPROVAL"].includes(t.status) && t.id !== task.id).slice(0, 6).map((t) => `${t.assignedTo}: ${t.title}`).join(" | ") || "none"}`,
    ].join("\n");
    const run = await runAgentTask(agent, task, context);
    nextTasks = updateTask(nextTasks, task.id, {
      status: run.ok ? "DONE" : "FAILED",
      result: run.result,
      evidence: [...run.evidence, ...(run.model ? [`model:${run.model}`] : [])],
      blockedReason: run.ok ? null : run.result,
    });
    nextAgents = setAgent(nextAgents, agent.id, {
      status: run.ok ? "DONE" : "ERROR",
      lastRanAt: now,
      lastResult: run.result.slice(0, 600),
      currentWork: run.ok ? agent.currentWork : "Recover from the failed task run.",
    });
    for (const followup of run.followups) {
      nextTasks = ensureTask(nextTasks, {
        title: followup.title,
        domain: nextAgents.find((item) => item.id === followup.assignedTo)?.domain ?? "CORE",
        assignedTo: followup.assignedTo as AgentId,
        priority: "MEDIUM",
        permissionRequired: "ANALYZE",
        objectiveId: task.objectiveId,
        source: `agent.${agent.id.toLowerCase()}`,
        definitionOfDone: followup.rationale,
      }).tasks;
    }
    await appendRuntimeEvent(createRuntimeEvent({
      type: run.ok ? "workforce.task_completed" : "workforce.task_failed",
      domain: task.domain,
      source: `jarvis.agent.${agent.id.toLowerCase()}`,
      importance: run.ok ? "NORMAL" : "IMPORTANT",
      summary: `${agent.id}: ${task.title} · ${run.ok ? "done" : "failed"} · ${run.toolCalls} tool call${run.toolCalls === 1 ? "" : "s"}`,
    }));
  }
  return { tasks: nextTasks, agents: nextAgents };
}

/** Run one specific task now (owner action from the floor). */
export async function runWorkforceTaskNow(taskId: string): Promise<AgentTask | null> {
  const state = await getOrSeedWorkforceState();
  const task = (state.tasks ?? []).find((item) => item.id === taskId);
  if (!task || !["QUEUED", "FAILED"].includes(task.status)) return null;
  if (task.governance?.action !== "AUTO_PROCEED" && task.governance?.action !== "USER_AUTHORIZED") return null;
  const now = new Date().toISOString();
  const queued = updateTask(state.tasks ?? [], taskId, { status: "QUEUED" });
  const executed = await executeQueuedTasks(queued, state.agents, now, taskId);
  const tasks = applyTruthVerification(executed.tasks, now);
  await setWorkforceState({ ...state, tasks: pruneTasks(tasks), agents: executed.agents });
  return tasks.find((item) => item.id === taskId) ?? null;
}

/** Dwight approves or denies a task that is waiting on him. Recorded server-side. */
export async function decideWorkforceTask(taskId: string, decision: "APPROVED" | "DENIED", reason?: string | null): Promise<AgentTask | null> {
  const state = await getOrSeedWorkforceState();
  const task = (state.tasks ?? []).find((item) => item.id === taskId);
  if (!task || task.status !== "WAITING_APPROVAL") return null;
  if (task.governance?.action === "BLOCKED") return null;
  await recordApproval({ subjectType: "WORKFORCE_TASK", subjectId: taskId, decision, reason });
  const evaluatedAt = new Date().toISOString();
  const patch: Partial<AgentTask> = decision === "APPROVED"
    ? {
        status: "QUEUED",
        blockedReason: null,
        governance: { risk: task.governance?.risk ?? "MEDIUM", scope: task.governance?.scope ?? "EXECUTE", action: "USER_AUTHORIZED", reason: "Approved by Dwight" + (reason ? `: ${reason}` : "."), evaluatedAt },
      }
    : { status: "CANCELLED", blockedReason: "Denied by Dwight" + (reason ? `: ${reason}` : "."), result: "Denied by Dwight." };
  const tasks = updateTask(state.tasks ?? [], taskId, patch);
  await setWorkforceState({ ...state, tasks: pruneTasks(tasks) });
  await appendRuntimeEvent(createRuntimeEvent({
    type: decision === "APPROVED" ? "workforce.task_approved" : "workforce.task_denied",
    domain: task.domain,
    source: "dwight.approval",
    importance: "IMPORTANT",
    summary: `${decision === "APPROVED" ? "Approved" : "Denied"}: ${task.assignedTo} · ${task.title}`,
  }));
  return tasks.find((item) => item.id === taskId) ?? null;
}
