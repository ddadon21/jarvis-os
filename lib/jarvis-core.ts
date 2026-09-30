"server-only";

import { getAssistantAlerts, getAssistantRuntimeState } from "./jarvis-assistant-runtime";
import { getOrSeedFinanceState } from "./finance-live";
import { getJarvisIntegrationRegistry, type JarvisIntegrationState } from "./jarvis-integration-registry";
import { JARVIS_AUTHORITY_CLASSES, JARVIS_BALANCED_GOVERNANCE, JARVIS_OPERATING_DOCTRINE } from "./jarvis-core-policy";
import { getLatestPulse, getRecentEvents, type RuntimeDomain, type TruthState } from "./jarvis-runtime";
import { getOrSeedWorkforceState } from "./jarvis-workforce";
import { getTradingState } from "./trading-runtime";

export type JarvisCoreTruthState = TruthState | "UNKNOWN";
export type JarvisCoreHealth = "HEALTHY" | "DEGRADED" | "BLOCKED" | "UNKNOWN";
export type JarvisCoreAuthority = "READ_ONLY" | "WRITE_INTERNAL" | "EXTERNAL_APPROVAL" | "HARD_LIMIT";

export type JarvisCoreSource = {
  id: string;
  domain: RuntimeDomain;
  health: JarvisCoreHealth;
  truth: JarvisCoreTruthState;
  asOf: string | null;
  summary: string;
  source: string;
};

export type JarvisCoreTool = {
  id: string;
  label: string;
  state: JarvisIntegrationState | "NOT_CONNECTED";
  authority: JarvisCoreAuthority;
  capabilities: string[];
  note: string;
};

export type JarvisCoreDecision = {
  id: string;
  at: string;
  decision: string;
  reason: string;
  expectedOutcome: string;
  evidence: string[];
  objectiveId: string | null;
  source: string;
};

export type JarvisCoreState = {
  version: 1;
  generatedAt: string;
  identity: {
    name: "JARVIS";
    owner: "Dwight Johnson";
    role: "Private executive operating intelligence";
  };
  doctrine: readonly string[];
  governance: typeof JARVIS_BALANCED_GOVERNANCE;
  authorityClasses: typeof JARVIS_AUTHORITY_CLASSES;
  truth: {
    verificationRate: number;
    verifiedOutcomes: number;
    observedOutcomes: number;
    claimedOutcomes: number;
    disputedOutcomes: number;
    sources: JarvisCoreSource[];
  };
  worldState: {
    asOf: string;
    mission: string;
    domains: JarvisCoreSource[];
  };
  permissions: {
    defaultPosture: "CONTROLLED_AGGRESSION";
    autoProceed: string[];
    askDwightFirst: string[];
    hardLimits: string[];
  };
  tools: JarvisCoreTool[];
  memory: {
    decisions: JarvisCoreDecision[];
    recentEvents: Array<{
      id: string;
      domain: RuntimeDomain;
      importance: string;
      occurredAt: string;
      summary: string;
      source: string;
    }>;
    objectives: Array<{
      id: string;
      title: string;
      domain: RuntimeDomain;
      status: string;
      currentFocus: string;
      successDefinition: string;
    }>;
  };
  exceptions: {
    waitingOnDwight: number;
    criticalGaps: number;
    failedWork: number;
    staleWork: number;
    items: Array<{
      type: string;
      title: string;
      owner: string;
      reason: string;
    }>;
  };
  subsystems: {
    workforce: {
      status: string;
      autonomyEnabled: boolean;
      lastCycleAt: string | null;
    };
    voice: {
      realtimeProvider: "OPENAI";
      fallback: "BROWSER_SPEECH";
      note: string;
    };
    desktop: {
      state: "PARTIAL";
      note: string;
    };
    obsidian: {
      state: "CONNECTED" | "DEGRADED" | "UNKNOWN";
      note: string;
    };
  };
};

function integrationAuthority(id: string): JarvisCoreAuthority {
  if (id === "OBSIDIAN" || id === "SUPABASE") return "WRITE_INTERNAL";
  if (id === "TRADING_OBSERVER") return "READ_ONLY";
  if (["GOOGLE_WORKSPACE", "MICROSOFT_365", "ZOOM", "DISCORD", "ICLOUD_CALENDAR"].includes(id)) return "EXTERNAL_APPROVAL";
  return "READ_ONLY";
}

function integrationHealth(state: JarvisIntegrationState): JarvisCoreHealth {
  if (state === "CONNECTED") return "HEALTHY";
  if (state === "DEGRADED") return "DEGRADED";
  return "UNKNOWN";
}

function sourceTruth(connected: boolean, degraded = false): JarvisCoreTruthState {
  if (degraded) return "DISPUTED";
  return connected ? "OBSERVED" : "UNKNOWN";
}

export type JarvisCoreInputs = {
  workforce: Awaited<ReturnType<typeof getOrSeedWorkforceState>>;
  finance: Awaited<ReturnType<typeof getOrSeedFinanceState>>;
  trading: Awaited<ReturnType<typeof getTradingState>>;
  assistant: Awaited<ReturnType<typeof getAssistantRuntimeState>>;
  pulse: Awaited<ReturnType<typeof getLatestPulse>>;
  events: Awaited<ReturnType<typeof getRecentEvents>>;
  integrations: Awaited<ReturnType<typeof getJarvisIntegrationRegistry>>;
};

export function buildJarvisCoreState(input: JarvisCoreInputs): JarvisCoreState {
  const generatedAt = new Date().toISOString();
  const { workforce, finance, trading, assistant, pulse, events, integrations } = input;

  const operating = workforce.operatingSystem;
  const truth = operating?.truth;
  const assistantAlerts = getAssistantAlerts(assistant);
  const financeSource: JarvisCoreSource = {
    id: "finance",
    domain: "FINANCE",
    health: finance.mode === "DIRECT" ? "HEALTHY" : "DEGRADED",
    truth: finance.mode === "DIRECT" ? "VERIFIED" : "OBSERVED",
    asOf: finance.asOf,
    summary: finance.mode === "DIRECT"
      ? "Direct finance runtime is available."
      : "Finance is using the latest synchronized snapshot rather than a direct live provider.",
    source: finance.source,
  };
  const tradingSource: JarvisCoreSource = {
    id: "trading",
    domain: "TRADING",
    health: trading.account.connection === "OBSERVING"
      ? "HEALTHY"
      : trading.account.connection === "DEGRADED"
        ? "DEGRADED"
        : "UNKNOWN",
    truth: trading.account.lastObservedAt
      ? trading.account.connection === "DEGRADED" ? "DISPUTED" : "OBSERVED"
      : "UNKNOWN",
    asOf: trading.account.lastObservedAt,
    summary: trading.account.lastObservedAt
      ? `Trading Observer state is ${trading.account.connection}; latest observed state is ${trading.observer?.status ?? "unknown"}.`
      : "No current Trading Observer evidence is available.",
    source: "trading.observer",
  };
  const sentrySource: JarvisCoreSource = {
    id: "sentryops",
    domain: "SENTRYOPS",
    health: pulse?.status === "OK" ? "HEALTHY" : pulse?.status === "ERROR" ? "DEGRADED" : "UNKNOWN",
    truth: pulse?.status === "OK" && pulse.sourceCount > 0
      ? "OBSERVED"
      : pulse?.status === "ERROR"
        ? "DISPUTED"
        : "UNKNOWN",
    asOf: pulse?.ranAt ?? null,
    summary: pulse?.summary ?? "No current SentryOps research pulse is available.",
    source: "jarvis.research-pulse",
  };
  const lifeSource: JarvisCoreSource = {
    id: "life",
    domain: "LIFE",
    health: "UNKNOWN",
    truth: "UNKNOWN",
    asOf: null,
    summary: "Life has user-facing state but does not yet expose equivalent server-side telemetry to JARVIS Core.",
    source: "life.client-state",
  };
  const assistantConnected = Object.values(assistant.sources).some(value => value === "CONNECTED");
  const assistantDegraded = assistantAlerts.some(alert => alert.priority === "CRITICAL");
  const assistantSource: JarvisCoreSource = {
    id: "assistant",
    domain: "CORE",
    health: assistantDegraded ? "DEGRADED" : assistantConnected ? "HEALTHY" : "UNKNOWN",
    truth: sourceTruth(assistantConnected, assistantDegraded),
    asOf: assistant.updatedAt,
    summary: assistantConnected
      ? "At least one assistant source is connected; individual Calendar, Email, Meeting, Contacts, and Web states remain explicit."
      : "No external assistant source is currently confirmed connected.",
    source: "jarvis.assistant-runtime",
  };
  const workforceSource: JarvisCoreSource = {
    id: "workforce",
    domain: "CORE",
    health: workforce.status === "ACTIVE" ? "HEALTHY" : workforce.status === "DEGRADED" ? "DEGRADED" : "UNKNOWN",
    truth: truth?.disputed ? "DISPUTED" : truth?.verificationRate === 100 ? "VERIFIED" : truth?.verified ? "OBSERVED" : "UNKNOWN",
    asOf: workforce.lastCycleAt,
    summary: workforce.executiveSummary,
    source: "jarvis.workforce",
  };

  const sources = [workforceSource, financeSource, tradingSource, sentrySource, assistantSource, lifeSource];

  const tools: JarvisCoreTool[] = integrations.map(integration => ({
    id: integration.id,
    label: integration.label,
    state: integration.state,
    authority: integrationAuthority(integration.id),
    capabilities: integration.capabilities,
    note: integration.note,
  }));
  tools.push({
    id: "DESKTOP_ACTION_RUNTIME",
    label: "Windows Desktop Actions",
    state: "NOT_CONNECTED",
    authority: "EXTERNAL_APPROVAL",
    capabilities: ["Open/focus applications", "Window UI automation", "Clipboard", "Approved local commands", "Browser handoff"],
    note: "The current Local Agent can observe TradingView and bridge Obsidian, but general Windows action execution is not implemented yet.",
  });
  tools.push({
    id: "CODING_EXECUTORS",
    label: "Coding Executors",
    state: "NOT_CONNECTED",
    authority: "WRITE_INTERNAL",
    capabilities: ["Claude Code", "Codex", "Project workspace execution", "Tests and build verification"],
    note: "Model routing exists, but JARVIS does not yet own a dedicated coding-executor tool contract.",
  });

  const decisions: JarvisCoreDecision[] = (operating?.decisionMemory ?? []).map(item => ({
    id: item.id,
    at: item.at,
    decision: item.decision,
    reason: item.reason,
    expectedOutcome: item.expectedOutcome,
    evidence: item.evidence,
    objectiveId: item.objectiveId,
    source: "jarvis.core/workforce-migrated",
  }));

  const continuity = operating?.continuity;
  const criticalGaps = (operating?.gaps ?? []).filter(gap => gap.status !== "RESOLVED" && gap.risk === "CRITICAL").length;
  const failedWork = (workforce.tasks ?? []).filter(task => task.status === "FAILED").length;
  const staleWork = continuity?.executiveExceptions.filter(item => item.type === "STALE_WORK").length ?? 0;

  const obsidian = integrations.find(item => item.id === "OBSIDIAN");

  return {
    version: 1,
    generatedAt,
    identity: {
      name: "JARVIS",
      owner: "Dwight Johnson",
      role: "Private executive operating intelligence",
    },
    doctrine: JARVIS_OPERATING_DOCTRINE,
    governance: JARVIS_BALANCED_GOVERNANCE,
    authorityClasses: JARVIS_AUTHORITY_CLASSES,
    truth: {
      verificationRate: truth?.verificationRate ?? 100,
      verifiedOutcomes: truth?.verified ?? 0,
      observedOutcomes: truth?.observed ?? 0,
      claimedOutcomes: truth?.claimed ?? 0,
      disputedOutcomes: truth?.disputed ?? 0,
      sources,
    },
    worldState: {
      asOf: generatedAt,
      mission: operating?.worldState.mission ?? workforce.executiveSummary,
      domains: sources,
    },
    permissions: {
      defaultPosture: "CONTROLLED_AGGRESSION",
      autoProceed: [...JARVIS_BALANCED_GOVERNANCE.autoProceed],
      askDwightFirst: [...JARVIS_BALANCED_GOVERNANCE.askDwightFirst],
      hardLimits: [...JARVIS_BALANCED_GOVERNANCE.neverWithoutExplicitUnlock],
    },
    tools,
    memory: {
      decisions,
      recentEvents: events.slice(0, 30).map(event => ({
        id: event.id,
        domain: event.domain,
        importance: event.importance,
        occurredAt: event.occurredAt,
        summary: event.summary,
        source: event.source,
      })),
      objectives: workforce.objectives.slice(0, 20).map(objective => ({
        id: objective.id,
        title: objective.title,
        domain: objective.domain,
        status: objective.status,
        currentFocus: objective.currentFocus,
        successDefinition: objective.successDefinition,
      })),
    },
    exceptions: {
      waitingOnDwight: continuity?.last7Days.escalations ?? 0,
      criticalGaps,
      failedWork,
      staleWork,
      items: (continuity?.executiveExceptions ?? []).map(item => ({
        type: item.type,
        title: item.title,
        owner: item.owner,
        reason: item.reason,
      })),
    },
    subsystems: {
      workforce: {
        status: workforce.status,
        autonomyEnabled: workforce.autonomy?.enabled === true,
        lastCycleAt: workforce.lastCycleAt,
      },
      voice: {
        realtimeProvider: "OPENAI",
        fallback: "BROWSER_SPEECH",
        note: "Realtime WebRTC voice is available when configured; browser speech remains the fallback and is not the target premium voice path.",
      },
      desktop: {
        state: "PARTIAL",
        note: "Screen observation and Obsidian bridging exist through the Windows Local Agent. General computer actions are Step 2.",
      },
      obsidian: {
        state: obsidian?.state === "CONNECTED" ? "CONNECTED" : obsidian?.state === "DEGRADED" ? "DEGRADED" : "UNKNOWN",
        note: obsidian?.note ?? "Obsidian state is unavailable.",
      },
    },
  };
}


export async function getJarvisCoreState(): Promise<JarvisCoreState> {
  const [workforce, finance, trading, assistant, pulse, events, integrations] = await Promise.all([
    getOrSeedWorkforceState(),
    getOrSeedFinanceState(),
    getTradingState(),
    getAssistantRuntimeState(),
    getLatestPulse(),
    getRecentEvents(),
    getJarvisIntegrationRegistry(),
  ]);
  return buildJarvisCoreState({ workforce, finance, trading, assistant, pulse, events, integrations });
}
