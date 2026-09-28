import { getCache } from "@vercel/functions";

export type RuntimeDomain = "TRADING" | "FINANCE" | "SENTRYOPS" | "LIFE" | "CORE";

export type RuntimeEvent = {
  id: string;
  type: string;
  domain: RuntimeDomain;
  source: string;
  importance: "BACKGROUND" | "NORMAL" | "IMPORTANT" | "TIME_SENSITIVE" | "CRITICAL";
  occurredAt: string;
  receivedAt: string;
  summary: string;
};

export type ResearchOpportunity = {
  title: string;
  whyItMatters: string;
  evidence: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
};

export type JarvisPulse = {
  id: string;
  ranAt: string;
  status: "OK" | "DEGRADED" | "ERROR";
  lane: "SENTRYOPS_RESEARCH" | "CORE_HEARTBEAT";
  summary: string;
  opportunities: ResearchOpportunity[];
  nextMove: {
    title: string;
    reason: string;
    domain: RuntimeDomain;
  };
  sourceCount: number;
};

export type AgentId =
  | "EXECUTIVE"
  | "FINANCE_CFO"
  | "SENTRYOPS_RESEARCH"
  | "TRADING_OBSERVER"
  | "BUILDER"
  | "JARVIS_QA";

export type AgentRunStatus = "IDLE" | "RUNNING" | "DONE" | "BLOCKED" | "ERROR";

export type AgentPermission =
  | "READ"
  | "ANALYZE"
  | "WRITE_INTERNAL"
  | "EXTERNAL_LOW_RISK"
  | "REQUIRES_APPROVAL";

export type AgentState = {
  id: AgentId;
  domain: RuntimeDomain;
  status: AgentRunStatus;
  permissionCeiling: AgentPermission;
  lastRanAt: string | null;
  lastResult: string;
  currentWork: string;
};

export type AgentTaskStatus =
  | "QUEUED"
  | "RUNNING"
  | "DONE"
  | "BLOCKED"
  | "FAILED"
  | "WAITING_APPROVAL";

export type AgentTaskPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type AgentTask = {
  id: string;
  title: string;
  domain: RuntimeDomain;
  assignedTo: AgentId;
  status: AgentTaskStatus;
  priority: AgentTaskPriority;
  permissionRequired: AgentPermission;
  createdAt: string;
  updatedAt: string;
  objectiveId: string | null;
  source: string;
  result: string | null;
  evidence: string[];
  blockedReason: string | null;
};

export type WorkforceObjective = {
  id: string;
  title: string;
  domain: RuntimeDomain;
  createdAt: string;
  updatedAt: string;
  status: "ACTIVE" | "BLOCKED" | "DONE" | "PAUSED";
  successDefinition: string;
  currentFocus: string;
  requiresApprovalForExternalActions: boolean;
};

export type WorkforceState = {
  version: 1;
  cycleId: string | null;
  lastCycleAt: string | null;
  status: "STARTING" | "ACTIVE" | "DEGRADED";
  agents: AgentState[];
  objectives: WorkforceObjective[];
  tasks?: AgentTask[];
  executiveSummary: string;
};

export type FinanceAccountState = {
  key: string;
  institution: string;
  name: string;
  type: "depository" | "investment" | "credit" | "loan";
  subtype: string | null;
  ownership: "PERSONAL" | "BUSINESS" | "AUTHORIZED_USER";
  role: string;
  current: number;
  available: number | null;
  limit: number | null;
  balanceUpdatedAt?: string | null;
  balanceAsOf?: string | null;
  balanceFreshness?: string;
};

export type FinanceLiabilityState = {
  accountKey: string;
  apr: number | null;
  minimum: number | null;
  due: string | null;
  statementDate?: string | null;
  lastPaymentDate?: string | null;
  isOverdue?: boolean;
};

export type FinanceGoalState = {
  name: string;
  state: "RED" | "YELLOW" | "GREEN" | "SETUP";
  progress: number | null;
  current: string;
  target: string;
  blocker: string;
};

export type FinanceRuntimeState = {
  version: 1;
  mode: "SYNCED_SNAPSHOT" | "DIRECT";
  source: string;
  asOf: string;
  connectionCount: number;
  accountCount: number;
  transactionHistory: string;
  recurringHistory: string;
  accounts: FinanceAccountState[];
  liabilities: FinanceLiabilityState[];
  metrics: {
    personalNetWorth: number;
    providerNetWorth: number;
    liquidity: number;
    investmentValue: number;
    personalDebt: number;
    authorizedUserBalance: number;
  };
  currentStage: string;
  nextStage: string;
  goals: FinanceGoalState[];
  note: string;
};

const LATEST_PULSE_KEY = "jarvis:runtime:latest-pulse:v1";
const RECENT_EVENTS_KEY = "jarvis:runtime:recent-events:v1";
const LAST_PULSE_AT_KEY = "jarvis:runtime:last-pulse-at:v1";
const WORKFORCE_STATE_KEY = "jarvis:runtime:workforce:v1";
const FINANCE_STATE_KEY = "jarvis:runtime:finance:v2";
const DURABLE_RUNTIME_TTL = 60 * 60 * 24 * 365;

type FallbackStore = Map<string, unknown>;

const globalForJarvis = globalThis as typeof globalThis & {
  __jarvisRuntimeFallback?: FallbackStore;
};

const fallbackStore = globalForJarvis.__jarvisRuntimeFallback ?? new Map<string, unknown>();
globalForJarvis.__jarvisRuntimeFallback = fallbackStore;

async function readValue<T>(key: string): Promise<T | null> {
  try {
    const cache = getCache();
    const value = await cache.get(key);
    return (value ?? null) as T | null;
  } catch {
    return (fallbackStore.get(key) as T | undefined) ?? null;
  }
}

async function writeValue<T>(key: string, value: T, ttl = DURABLE_RUNTIME_TTL): Promise<void> {
  fallbackStore.set(key, value);

  try {
    const cache = getCache();
    await cache.set(key, value, { ttl, tags: ["jarvis-runtime"] });
  } catch {
    // Local development and some preview environments may not expose Runtime Cache.
    // The in-process fallback keeps the app usable without pretending it is durable storage.
  }
}

export async function getLatestPulse(): Promise<JarvisPulse | null> {
  return readValue<JarvisPulse>(LATEST_PULSE_KEY);
}

export async function setLatestPulse(pulse: JarvisPulse): Promise<void> {
  await Promise.all([
    writeValue(LATEST_PULSE_KEY, pulse),
    writeValue(LAST_PULSE_AT_KEY, pulse.ranAt),
  ]);
}

export async function getLastPulseAt(): Promise<string | null> {
  return readValue<string>(LAST_PULSE_AT_KEY);
}

export async function getRecentEvents(): Promise<RuntimeEvent[]> {
  return (await readValue<RuntimeEvent[]>(RECENT_EVENTS_KEY)) ?? [];
}

export async function appendRuntimeEvent(event: RuntimeEvent): Promise<void> {
  const current = await getRecentEvents();
  const next = [event, ...current.filter((item) => item.id !== event.id)].slice(0, 100);
  await writeValue(RECENT_EVENTS_KEY, next);
}

export async function getWorkforceState(): Promise<WorkforceState | null> {
  return readValue<WorkforceState>(WORKFORCE_STATE_KEY);
}

export async function setWorkforceState(state: WorkforceState): Promise<void> {
  await writeValue(WORKFORCE_STATE_KEY, state);
}

export async function getFinanceState(): Promise<FinanceRuntimeState | null> {
  return readValue<FinanceRuntimeState>(FINANCE_STATE_KEY);
}

export async function setFinanceState(state: FinanceRuntimeState): Promise<void> {
  await writeValue(FINANCE_STATE_KEY, state);
}

export function createRuntimeEvent(input: {
  type: string;
  domain?: RuntimeDomain;
  source?: string;
  importance?: RuntimeEvent["importance"];
  occurredAt?: string;
  summary: string;
}): RuntimeEvent {
  return {
    id: crypto.randomUUID(),
    type: sanitizeLabel(input.type, "event.unknown"),
    domain: normalizeDomain(input.domain),
    source: sanitizeLabel(input.source, "jarvis"),
    importance: normalizeImportance(input.importance),
    occurredAt: isIsoDate(input.occurredAt) ? input.occurredAt! : new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    summary: input.summary.trim().slice(0, 500),
  };
}

export function shouldRunPulse(lastRanAt: string | null, minimumMinutes: number): boolean {
  if (!lastRanAt) return true;
  const last = Date.parse(lastRanAt);
  if (!Number.isFinite(last)) return true;
  return Date.now() - last >= minimumMinutes * 60_000;
}

function sanitizeLabel(value: string | undefined, fallback: string): string {
  const cleaned = typeof value === "string" ? value.trim().slice(0, 120) : "";
  return cleaned || fallback;
}

function normalizeDomain(value: unknown): RuntimeDomain {
  const domain = typeof value === "string" ? value.toUpperCase() : "CORE";
  if (domain === "TRADING" || domain === "FINANCE" || domain === "SENTRYOPS" || domain === "LIFE") {
    return domain;
  }
  return "CORE";
}

function normalizeImportance(value: unknown): RuntimeEvent["importance"] {
  const level = typeof value === "string" ? value.toUpperCase() : "NORMAL";
  if (level === "BACKGROUND" || level === "IMPORTANT" || level === "TIME_SENSITIVE" || level === "CRITICAL") {
    return level;
  }
  return "NORMAL";
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
