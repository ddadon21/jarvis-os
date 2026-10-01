"server-only";

import { getAssistantAlerts, getAssistantRuntimeState } from "./jarvis-assistant-runtime";
import { getOrSeedFinanceState } from "./finance-live";
import { getJarvisIntegrationRegistry, type JarvisIntegrationState } from "./jarvis-integration-registry";
import { JARVIS_AUTHORITY_CLASSES, JARVIS_BALANCED_GOVERNANCE, JARVIS_OPERATING_DOCTRINE } from "./jarvis-core-policy";
import { getLatestPulse, getRecentEvents, type RuntimeDomain, type TruthState } from "./jarvis-runtime";
import { getOrSeedWorkforceState } from "./jarvis-workforce";
import { getTradingState } from "./trading-runtime";
import { getLocalAgentPresence } from "./trading-device-link";
import { getElevenLabsRuntimeState } from "./jarvis-voice-runtime";

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
      primaryProvider: "ELEVENLABS" | "BROWSER_SPEECH";
      realtimeProvider: "OPENAI";
      fallback: "BROWSER_SPEECH";
      premiumConfigured: boolean;
      model: string;
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
  localAgent: Awaited<ReturnType<typeof getLocalAgentPresence>>;
  premiumVoice: Awaited<ReturnType<typeof getElevenLabsRuntimeState>>;
};

export function buildJarvisCoreState(input: JarvisCoreInputs): JarvisCoreState {
  const generatedAt = new Date().toISOString();
  const { workforce, finance, trading, assistant, pulse, events, integrations, localAgent, premiumVoice } = input;

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
    state: localAgent?.online && localAgent.desktopRuntime ? "CONNECTED" : localAgent?.online ? "DEGRADED" : "NOT_CONNECTED",
    authority: "EXTERNAL_APPROVAL",
    capabilities: [
      "Desktop context",
      "On-demand screen capture",
      "Open/focus applications",
      "Window UI automation",
      "Clipboard read/write",
      "Open files and HTTPS URLs",
      "Approved local diagnostics",
      "Browser page accessibility read",
      "Browser navigate/search/back",
      "Controlled Codex and Claude Code execution",
    ],
    note: localAgent?.online && localAgent.desktopRuntime
      ? `JARVIS Desktop Runtime ${localAgent.observerVersion ?? "0.8+"} is online on ${localAgent.deviceName ?? "the paired Windows PC"}.`
      : localAgent?.online
        ? `The Local Agent is online, but version ${localAgent.observerVersion ?? "unknown"} predates the Desktop Action Runtime. Update the Windows agent to 0.8.0 or newer.`
        : "The Windows Local Agent is not currently online, so JARVIS must not claim computer-control capability.",
  });
  tools.push({
    id: "BROWSER_RUNTIME",
    label: "Browser Runtime",
    state: localAgent?.online && localAgent.browserRuntime ? "CONNECTED" : localAgent?.online ? "DEGRADED" : "NOT_CONNECTED",
    authority: "EXTERNAL_APPROVAL",
    capabilities: ["Read current Chrome/Edge page", "Navigate", "Search", "Back", "Reuse accessibility click/type"],
    note: localAgent?.online && localAgent.browserRuntime
      ? "Local Agent 0.9+ reports browser automation support. Reading is automatic; navigation, clicks, typing, and submissions remain approval-gated."
      : localAgent?.online
        ? "Browser runtime requires Local Agent 0.9.0 or newer."
        : "Browser runtime requires the Windows Local Agent to be online.",
  });

  const premiumVoiceConfigured = Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID);
  const premiumVoiceState =
    !premiumVoiceConfigured ? "NOT_CONNECTED" :
    premiumVoice.status === "CONNECTED" ? "CONNECTED" :
    premiumVoice.status === "PLAN_REQUIRED" || premiumVoice.status === "AUTH_ERROR" || premiumVoice.status === "DEGRADED" ? "DEGRADED" :
    "NEEDS_CONNECTION";
  tools.push({
    id: "ELEVENLABS_VOICE",
    label: "Jarvis Premium Voice",
    state: premiumVoiceState,
    authority: "READ_ONLY",
    capabilities: ["Premium text-to-speech", "British voice profile", "Streaming audio output"],
    note: !premiumVoiceConfigured
      ? "Voice code is installed, but ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID are still required in the deployment."
      : premiumVoice.status === "CONNECTED"
        ? `ElevenLabs TTS is verified using ${premiumVoice.model}.`
        : premiumVoice.status === "PLAN_REQUIRED"
          ? "ElevenLabs is configured, but the selected Voice Library voice requires a paid subscription for API use."
          : premiumVoice.status === "AUTH_ERROR"
            ? "ElevenLabs is configured, but the provider rejected the current API authentication or permissions."
            : premiumVoice.status === "DEGRADED"
              ? premiumVoice.detail
              : "ElevenLabs is configured but has not yet completed a successful TTS verification.",
  });
  const codingVersionReady = Boolean(localAgent?.online && localAgent.codingRuntime);
  const codexReady = Boolean(codingVersionReady && localAgent?.codexCli);
  const claudeReady = Boolean(codingVersionReady && localAgent?.claudeCli);
  tools.push({
    id: "CODING_EXECUTORS",
    label: "Coding Executors",
    state: codexReady && claudeReady
      ? "CONNECTED"
      : codingVersionReady && (codexReady || claudeReady)
        ? "DEGRADED"
        : "NOT_CONNECTED",
    authority: "WRITE_INTERNAL",
    capabilities: [
      codexReady ? "Codex CLI verified" : "Codex CLI not verified",
      claudeReady ? "Claude Code CLI verified" : "Claude Code CLI not verified",
      "Git-workspace-scoped execution",
      "Tests and build verification",
    ],
    note: !localAgent?.online
      ? "Coding executors require the paired Windows Local Agent to be online."
      : !codingVersionReady
        ? "Local Agent is online, but coding executors require version 0.9.0 or newer."
        : codexReady && claudeReady
          ? "Codex and Claude Code are both present on the Windows machine and available through the approved Git-workspace executor."
          : `Local Agent 0.9+ is ready, but ${!codexReady && !claudeReady ? "neither Codex nor Claude Code is" : !codexReady ? "Codex is not" : "Claude Code is not"} currently verified on PATH.`,
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
        primaryProvider: premiumVoiceConfigured ? "ELEVENLABS" : "BROWSER_SPEECH",
        realtimeProvider: "OPENAI",
        fallback: "BROWSER_SPEECH",
        premiumConfigured: premiumVoiceConfigured,
        model: premiumVoice.model,
        note: !premiumVoiceConfigured
          ? "ElevenLabs integration is installed but not configured yet."
          : premiumVoice.status === "CONNECTED"
            ? "ElevenLabs is the verified primary spoken-output voice. Browser speech remains emergency fallback only."
            : premiumVoice.status === "PLAN_REQUIRED"
              ? "ElevenLabs is configured, but the selected library voice is blocked until the account is on a paid plan."
              : premiumVoice.detail,
      },
      desktop: {
        state: localAgent?.online && localAgent.desktopRuntime ? "PARTIAL" : "PARTIAL",
        note: localAgent?.online && localAgent.desktopRuntime
          ? localAgent.browserRuntime && localAgent.codingRuntime
            ? "Desktop Runtime is online with browser navigation/read automation and controlled local coding executors."
            : "Desktop Runtime is online with first-pass hands/eyes capabilities; browser/coding extensions require Local Agent 0.9.0."
          : "The Desktop Runtime code exists, but the paired Windows agent must be updated and online before JARVIS can use it.",
      },
      obsidian: {
        state: obsidian?.state === "CONNECTED" ? "CONNECTED" : obsidian?.state === "DEGRADED" ? "DEGRADED" : "UNKNOWN",
        note: obsidian?.note ?? "Obsidian state is unavailable.",
      },
    },
  };
}


export async function getJarvisCoreState(): Promise<JarvisCoreState> {
  const [workforce, finance, trading, assistant, pulse, events, integrations, localAgent, premiumVoice] = await Promise.all([
    getOrSeedWorkforceState(),
    getOrSeedFinanceState(),
    getTradingState(),
    getAssistantRuntimeState(),
    getLatestPulse(),
    getRecentEvents(),
    getJarvisIntegrationRegistry(),
    getLocalAgentPresence(),
    getElevenLabsRuntimeState(),
  ]);
  return buildJarvisCoreState({ workforce, finance, trading, assistant, pulse, events, integrations, localAgent, premiumVoice });
}
