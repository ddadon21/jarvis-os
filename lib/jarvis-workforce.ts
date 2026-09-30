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
  WorkforceGap,
  WorkforceGovernanceDecision,
  WorkforceObjective,
  WorkforceOperatingSystem,
  WorkforceState,
  appendRuntimeEvent,
  createRuntimeEvent,
  getLatestPulse,
  getLastPulseAt,
  getRecentEvents,
  getWorkforceState,
  setWorkforceState,
  shouldRunPulse,
} from "./jarvis-runtime";

const OPERATING_DOCTRINE = [
  "See the mission.",
  "Find the gaps.",
  "Do the necessary work.",
  "Close the loop.",
  "Verify the result.",
  "Then expand.",
];

const BORING_WORK = [
  "Review stale or ownerless tasks",
  "Verify durable persistence and recovery paths",
  "Reproduce unresolved bugs before adding features",
  "Check duplicate workflow / agent logic",
  "Validate backups, authorization, and security boundaries",
  "Document fixes so the same failure does not recur",
];

const BALANCED_GOVERNANCE: NonNullable<WorkforceOperatingSystem["governance"]> = {
  mode: "BALANCED_AUTONOMY",
  standard: "Controlled aggression: bias to decisive action inside approved missions, but escalate irreversibility, mission expansion, and weakly-evidenced redesigns.",
  autoProceed: [
    "Low- and medium-risk reversible internal work inside an approved objective",
    "Research, monitoring, testing, validation, documentation, cleanup, retries, recovery, and measured experiments",
    "Small fixes and tactical optimizations with evidence, rollback paths, and a definition of done",
    "Cross-agent internal delegation that stays inside the same approved objective and permission ceilings",
  ],
  askDwightFirst: [
    "New mission, major scope expansion, or material architecture redesign",
    "External communication, spending, production-risk changes, permissions, contracts, or consequential account changes",
    "A change whose downside is difficult to reverse, whose blast radius is high, or whose evidence is weak",
  ],
  neverWithoutExplicitUnlock: [
    "Live trade execution or unrestricted money movement",
    "Bypassing approval boundaries, exposing secrets, or silently expanding agent permissions",
    "Changing the governance rules themselves to gain more authority",
  ],
  changeControl: "Observe → reproduce → diagnose → smallest reversible intervention → measure → QA → keep or revert. Redesign is the last resort after repeated evidence.",
  scopeControl: "Agents may move fast and delegate inside approved objectives. New ideas go to Vision/Backlog; agents may not create a new mission or materially widen scope without Dwight.",
  exceptionRule: "Dwight can explicitly authorize expansion; hard safety and permission boundaries still remain in force.",
};

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
    const tasks = (Array.isArray(existing.tasks) ? existing.tasks : []).map((task) => ({
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
    }));
    const operatingSystem = existing.operatingSystem
      ? {
          ...existing.operatingSystem,
          governance: existing.operatingSystem.governance ?? BALANCED_GOVERNANCE,
        }
      : buildOperatingSystem({
          previous: existing,
          agents,
          tasks,
          executiveFocus: existing.executiveSummary || "Close the highest-risk open loop before expanding.",
        });
    const changed =
      agents.length !== existing.agents.length ||
      objectives.length !== existing.objectives.length ||
      !Array.isArray(existing.tasks) ||
      !existing.operatingSystem ||
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
  await emitHandoff("CFO", "EXECUTIVE", "FINANCE", financeResult);

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
  const sentryDegraded = sentryPulse.status === "DEGRADED";
  const sentryResult = researchDue
    ? sentryPulse.summary
    : "Research pulse is current; no duplicate deep-research spend was needed this hourly workforce cycle. Latest: " + sentryPulse.summary;
  agents = setAgent(agents, "SENTRYOPS_RESEARCH", {
    status: sentryFailed ? "ERROR" : sentryDegraded ? "BLOCKED" : "DONE",
    lastRanAt: now,
    lastResult: sentryResult,
    currentWork: sentryPulse.nextMove.title,
  });
  tasks = updateTask(tasks, sentryTaskResult.task.id, {
    status: sentryFailed ? "FAILED" : sentryDegraded ? "BLOCKED" : "DONE",
    result: sentryResult,
    evidence: [`sources=${sentryPulse.sourceCount}`, `pulse=${sentryPulse.ranAt}`, `researchStatus=${sentryPulse.status}`],
    blockedReason: sentryFailed
      ? "The SentryOps research lane encountered an internal failure."
      : sentryDegraded
        ? "The live research provider was unavailable this cycle; JARVIS retained the last verified research state and will retry."
        : null,
  });
  await emitHandoff("RESEARCH", "BUILDER", "SENTRYOPS", sentryPulse.nextMove.title + " · " + sentryResult);

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
  await emitHandoff("OBSERVER", "BUILDER", "TRADING", tradingResult);

  const recentEvents = await getRecentEvents();
  const latestIndicatorEvidence = recentEvents.find((event) => event.type === "trading.indicator_evidence") ?? null;
  let indicatorLearningTask: AgentTask | null = null;
  if (latestIndicatorEvidence) {
    const source = `indicator-learning:${latestIndicatorEvidence.id}`;
    indicatorLearningTask = tasks.find((task) => task.source === source) ?? null;
    if (!indicatorLearningTask) {
      const indicatorTaskResult = ensureTask(tasks, {
        title: "Review new trading visual evidence against the DEVIANT indicator baseline",
        domain: "TRADING",
        assignedTo: "BUILDER",
        priority: "HIGH",
        permissionRequired: "WRITE_INTERNAL",
        objectiveId: null,
        source,
      });
      tasks = indicatorTaskResult.tasks;
      indicatorLearningTask = indicatorTaskResult.task;
    }
  }

  tasks = updateTask(tasks, infraTaskResult.task.id, { status: "RUNNING", result: null, blockedReason: null });
  tasks = updateTask(tasks, securityTaskResult.task.id, { status: "RUNNING", result: null, blockedReason: null });
  tasks = updateTask(tasks, integrationsTaskResult.task.id, { status: "RUNNING", result: null, blockedReason: null });

  const integrationRegistry = await getJarvisIntegrationRegistry();
  const coreIntegrationIds = new Set(["SUPABASE", "OBSIDIAN", "TRADING_OBSERVER"]);
  const coreIntegrations = integrationRegistry.filter((item) => coreIntegrationIds.has(item.id));
  const degradedCore = coreIntegrations.filter((item) => item.state === "DEGRADED");
  const unattachedCore = coreIntegrations.filter((item) => item.state === "NEEDS_CONNECTION");
  const activeIntegrations = integrationRegistry.filter((item) => item.state !== "NEEDS_APP_SETUP" && item.state !== "NEEDS_CONNECTION");
  const degradedConfigured = activeIntegrations.filter((item) => item.state === "DEGRADED");

  const infraResult = degradedCore.length
    ? "Infrastructure check found degraded core dependencies: " + degradedCore.map((item) => item.label).join(", ") + "."
    : unattachedCore.length
      ? "Infrastructure is operational. Unattached preview-only mirrors: " + unattachedCore.map((item) => item.label).join(", ") + ". Vercel Runtime Cache remains active for the workforce."
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
  const productionRuntime = process.env.VERCEL_ENV === "production";
  if (productionRuntime && !process.env.CRON_SECRET) securityFindings.push("CRON_SECRET missing in production");
  if (productionRuntime && !process.env.SUPABASE_SERVICE_ROLE_KEY) securityFindings.push("Supabase service role unavailable to production server runtime");
  const securityResult = securityFindings.length
    ? "Security audit found production configuration risks: " + securityFindings.join("; ") + "."
    : "Security audit passed baseline checks. Preview-only missing service credentials are treated as environment configuration, not security incidents.";
  agents = setAgent(agents, "IT_SECURITY", {
    status: securityFindings.length ? "ERROR" : "DONE",
    lastRanAt: now,
    lastResult: securityResult,
    currentWork: securityFindings.length
      ? "Resolve the reported production configuration risks without exposing secret values."
      : "Watch authorization boundaries and prevent agents from exceeding permission ceilings.",
  });
  tasks = updateTask(tasks, securityTaskResult.task.id, {
    status: securityFindings.length ? "FAILED" : "DONE",
    result: securityResult,
    evidence: [
      "environment=" + (process.env.VERCEL_ENV || "local"),
      "cronSecret=" + (process.env.CRON_SECRET ? "configured" : productionRuntime ? "missing" : "optional-preview"),
      "supabaseServiceRole=" + (process.env.SUPABASE_SERVICE_ROLE_KEY ? "configured" : productionRuntime ? "missing" : "optional-preview"),
    ],
    blockedReason: securityFindings.length ? securityResult : null,
  });

  const previewUnattached = integrationRegistry.filter((item) => item.state === "NEEDS_CONNECTION" && item.id === "SUPABASE");
  const integrationsResult = degradedConfigured.length
    ? "Integration check found degraded configured services: " + degradedConfigured.map((item) => item.label).join(", ") + "."
    : previewUnattached.length
      ? "Connected services are healthy. Supabase server mirroring is not attached to this preview deployment, so JARVIS is using Runtime Cache without reporting a false integration failure."
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
    evidence: integrationRegistry
      .filter((item) => item.state !== "NEEDS_APP_SETUP")
      .map((item) => item.id + "=" + item.state),
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

  if (indicatorLearningTask && latestIndicatorEvidence) {
    const indicatorReview = [
      "Trading evidence packet reviewed against the DEVIANT baseline.",
      latestIndicatorEvidence.summary,
      "The baseline Pine file remains immutable. Any code revision must be versioned and supported by repeated evidence across journal images/notes plus Observer state, not one isolated screenshot.",
    ].join(" ");
    agents = setAgent(agents, "BUILDER", {
      status: "DONE",
      lastRanAt: now,
      lastResult: indicatorReview,
      currentWork: "Correlate journal screenshots and notes with Observer evidence, then test repeatable DEVIANT arrow hypotheses before proposing code changes.",
    });
    tasks = updateTask(tasks, indicatorLearningTask.id, {
      status: "DONE",
      result: indicatorReview,
      evidence: [`runtimeEvent=${latestIndicatorEvidence.id}`, "baseline=deviant-refined-baseline-v1.pine"],
      blockedReason: null,
    });
    await emitHandoff("BUILDER", "QA", "TRADING", "Indicator evidence reviewed; baseline preserved and candidate changes remain evidence-gated.");
  } else if (activeBuildObjective) {
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
      lastResult: "No new build or indicator-learning evidence needs action this cycle. Builder remains available.",
      currentWork: "Stand by for validated product work or new trading evidence from Observer + journal images/notes.",
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
  await emitHandoff("QA", "EXECUTIVE", "CORE", qa.summary);

  const executiveSummary = synthesizeExecutiveSummary({
    financeResult,
    sentryResult,
    tradingResult,
    qaSummary: qa.summary,
  });
  const hasErrors = agents.some((agent) => agent.status === "ERROR");
  const hasBlockers = agents.some((agent) => agent.status === "BLOCKED");
  const executiveFocus = chooseExecutiveFocus(finance, sentryPulse.status, sentryPulse.nextMove.title, tasks);
  const operatingSystem = buildOperatingSystem({
    previous,
    agents,
    tasks,
    executiveFocus,
  });

  agents = setAgent(agents, "EXECUTIVE", {
    status: hasErrors ? "ERROR" : "DONE",
    lastRanAt: now,
    lastResult: executiveSummary,
    currentWork: operatingSystem.chiefOfStaff.highestLeverage,
  });

  const next: WorkforceState = {
    version: 1,
    cycleId,
    lastCycleAt: now,
    status: hasErrors || hasBlockers ? "DEGRADED" : "ACTIVE",
    agents,
    objectives: previous.objectives,
    tasks: pruneTasks(tasks),
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

function riskRank(value: WorkforceGap["risk"]) {
  return value === "CRITICAL" ? 4 : value === "HIGH" ? 3 : value === "MEDIUM" ? 2 : 1;
}

function buildOperatingSystem(input: {
  previous: WorkforceState | null;
  agents: AgentState[];
  tasks: AgentTask[];
  executiveFocus: string;
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
    const owner = task.status === "WAITING_APPROVAL" ? "EXECUTIVE" : task.assignedTo;
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

  return {
    doctrine: OPERATING_DOCTRINE,
    gaps: gapList,
    boringQueue: BORING_WORK,
    governance: BALANCED_GOVERNANCE,
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
  const openWithoutDone = tasks.filter(
    (task) =>
      ["QUEUED", "RUNNING", "BLOCKED", "WAITING_APPROVAL"].includes(task.status) &&
      !task.definitionOfDone?.trim(),
  );
  const governanceViolations = tasks.filter((task) =>
    (task.governance?.action === "BLOCKED" && !["BLOCKED", "FAILED"].includes(task.status)) ||
    (task.governance?.action === "WAIT_FOR_DWIGHT" && !["WAITING_APPROVAL", "BLOCKED", "FAILED"].includes(task.status)),
  );

  const evidence = [
    `errors=${failures.length}`,
    `blockedAgents=${blockers.length}`,
    `waitingApproval=${waitingApproval.length}`,
    `stillRunning=${running.length}`,
    `missingDefinitionOfDone=${openWithoutDone.length}`,
    `governanceViolations=${governanceViolations.length}`,
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

  if (blockers.length || waitingApproval.length || openWithoutDone.length) {
    return {
      hasErrors: false,
      hasBlockers: true,
      summary: `QA found no agent errors, but ${blockers.length} agent${blockers.length === 1 ? "" : "s"} are blocked, ${waitingApproval.length} task${waitingApproval.length === 1 ? "" : "s"} await approval, and ${openWithoutDone.length} open task${openWithoutDone.length === 1 ? "" : "s"} lack a definition of done.`,
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
    summary: "QA verified the cycle: no agent errors, no blocked agents, and no approval-gated tasks were hidden.",
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
