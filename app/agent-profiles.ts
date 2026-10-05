import {
  Bot,
  BrainCircuit,
  Code2,
  Eye,
  Landmark,
  Network,
  Search,
  ServerCog,
  ShieldCheck,
} from "lucide-react";

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
  /** Handoff label used in runtime events, e.g. "OBSERVER → BUILDER". */
  handoffName: string;
};

export const AGENT_PROFILES: Record<string, AgentProfile> = {
  EXECUTIVE: {
    name: "EXECUTIVE",
    short: "EX",
    role: "Chief of Staff",
    station: "Command Center",
    icon: BrainCircuit,
    specialty: "Priorities · delegation · approvals",
    accent: "#ef4444",
    zone: "COMMAND DECK",
    handoffName: "EXECUTIVE",
  },
  FINANCE_CFO: {
    name: "CFO",
    short: "CF",
    role: "Capital Intelligence",
    station: "Capital Desk",
    icon: Landmark,
    specialty: "Cash · debt · leverage · capital",
    accent: "#eab308",
    zone: "CAPITAL WING",
    handoffName: "CFO",
  },
  SENTRYOPS_RESEARCH: {
    name: "RESEARCH",
    short: "RS",
    role: "SentryOps Intelligence",
    station: "Research Lab",
    icon: Search,
    specialty: "Markets · agencies · competitors",
    accent: "#3b82f6",
    zone: "SENTRYOPS LAB",
    handoffName: "RESEARCH",
  },
  TRADING_OBSERVER: {
    name: "OBSERVER",
    short: "OB",
    role: "Trading Intelligence",
    station: "Market Bay",
    icon: Eye,
    specialty: "Setups · execution · behavior",
    accent: "#f97316",
    zone: "MARKET BAY",
    handoffName: "OBSERVER",
  },
  BUILDER: {
    name: "BUILDER",
    short: "BL",
    role: "Software Engineer",
    station: "Build Lab",
    icon: Code2,
    specialty: "JARVIS · SentryOps · automation",
    accent: "#14b8a6",
    zone: "ENGINEERING",
    handoffName: "BUILDER",
  },
  JARVIS_QA: {
    name: "QA",
    short: "QA",
    role: "Quality Watchdog",
    station: "QA Control",
    icon: ShieldCheck,
    specialty: "Failures · evidence · reliability",
    accent: "#a855f7",
    zone: "QA CONTROL",
    handoffName: "QA",
  },
  IT_INFRA: {
    name: "INFRA",
    short: "IN",
    role: "Infrastructure / SRE",
    station: "Network Operations",
    icon: ServerCog,
    specialty: "Runtime · uptime · persistence",
    accent: "#22c55e",
    zone: "NETWORK OPS",
    handoffName: "INFRA",
  },
  IT_SECURITY: {
    name: "SECURITY",
    short: "SC",
    role: "Security Operations",
    station: "Security Operations Center",
    icon: ShieldCheck,
    specialty: "Access · secrets · boundaries",
    accent: "#e11d48",
    zone: "SECURITY OPS",
    handoffName: "SECURITY",
  },
  IT_INTEGRATIONS: {
    name: "INTEGRATIONS",
    short: "IG",
    role: "Systems Integration",
    station: "Integration Hub",
    icon: Network,
    specialty: "APIs · connectors · handoffs",
    accent: "#06b6d4",
    zone: "INTEGRATION HUB",
    handoffName: "INTEGRATIONS",
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
