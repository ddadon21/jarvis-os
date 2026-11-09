import { Bot, Eye, House, ShieldCheck } from "lucide-react";

export type AgentStatus = "IDLE" | "RUNNING" | "DONE" | "BLOCKED" | "ERROR";

export type WorkforceAgent = {
  id: string;
  domain: string;
  status: AgentStatus;
  permissionCeiling: string;
  lastRanAt: string | null;
  lastResult: string;
  currentWork: string;
};

export type WorkforceTask = {
  id: string;
  title: string;
  domain: string;
  assignedTo: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "BLOCKED" | "FAILED" | "WAITING_APPROVAL" | "CANCELLED";
  priority: string;
  updatedAt: string;
  source?: string;
  result: string | null;
  evidence: string[];
  blockedReason: string | null;
  definitionOfDone?: string;
  verification?: {
    state: "CLAIMED" | "OBSERVED" | "VERIFIED" | "DISPUTED";
    checkedBy: string | null;
    checkedAt: string | null;
    rationale: string;
    evidenceCount: number;
  };
  governance?: {
    risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    scope: "MAINTAIN" | "EXECUTE" | "EXPAND";
    action: "AUTO_PROCEED" | "USER_AUTHORIZED" | "WAIT_FOR_DWIGHT" | "BLOCKED";
    reason: string;
    evaluatedAt: string;
  };
};

export type WorkforceEvent = {
  id: string;
  type: string;
  domain: string;
  source: string;
  importance: string;
  occurredAt: string;
  receivedAt: string;
  summary: string;
};

export type AgentProfile = {
  name: string;
  short: string;
  role: string;
  station: string;
  icon: typeof Bot;
  specialty: string;
  accent: string;
  zone: string;
  /** Handoff label used in runtime events, e.g. "OBSERVER → SUPERVISOR". */
  handoffName: string;
};

export const AGENT_PROFILES: Record<string, AgentProfile> = {
  SUPERVISOR: {
    name: "SUPERVISOR",
    short: "SV",
    role: "Keeps both agents in check",
    station: "Command Center",
    icon: ShieldCheck,
    specialty: "Evidence · system health · next step",
    accent: "#ef4444",
    zone: "COMMAND DECK",
    handoffName: "SUPERVISOR",
  },
  TRADING_OBSERVER: {
    name: "OBSERVER",
    short: "OB",
    role: "Trading · Arrow Indicator",
    station: "Market Bay",
    icon: Eye,
    specialty: "Your entries · arrow tuning · backtests",
    accent: "#f97316",
    zone: "MARKET BAY",
    handoffName: "OBSERVER",
  },
  DEAL_FINDER: {
    name: "DEAL FINDER",
    short: "DF",
    role: "Real Estate · Fix & Flip",
    station: "Deal Desk",
    icon: House,
    specialty: "Target areas · criteria · ranked deals",
    accent: "#22c55e",
    zone: "DEAL DESK",
    handoffName: "DEAL FINDER",
  },
};

export function profileFor(agent: Pick<WorkforceAgent, "id" | "domain" | "currentWork">): AgentProfile {
  return AGENT_PROFILES[agent.id] ?? {
    name: agent.id,
    short: agent.id.slice(0, 2),
    role: agent.domain,
    station: "Operations",
    icon: Bot,
    specialty: agent.currentWork,
    accent: "#94a3b8",
    zone: "OPERATIONS",
    handoffName: agent.id,
  };
}

export function timeAgo(value: string | null | undefined) {
  if (!value) return "NEVER";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "UNKNOWN";
  const delta = Math.max(0, Date.now() - parsed);
  const seconds = Math.floor(delta / 1000);
  if (seconds < 45) return "JUST NOW";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return Math.max(1, minutes) + "M AGO";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + "H AGO";
  return Math.floor(hours / 24) + "D AGO";
}

export function quickEvent(summary: string) {
  const compact = summary.replace(/\s+/g, " ").trim();
  const first = compact.split(/(?<=[.!?])\s+/)[0] || compact;
  return first.length > 96 ? first.slice(0, 93).trimEnd() + "…" : first;
}
