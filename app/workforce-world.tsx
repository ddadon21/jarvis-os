"use client";

import Link from "next/link";
import {
  Activity,
  Bot,
  BrainCircuit,
  BriefcaseBusiness,
  Building2,
  ChevronRight,
  CircleDot,
  Code2,
  Eye,
  Landmark,
  Network,
  Play,
  RefreshCcw,
  Search,
  ServerCog,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import styles from "./workforce-world.module.css";

type AgentStatus = "IDLE" | "RUNNING" | "DONE" | "BLOCKED" | "ERROR";
type AgentMotion = "READY" | "WALKING" | "RETURNING" | "SEATED" | "REPORTING" | "BLOCKED" | "ERROR";
type Agent = {
  id: string;
  domain: string;
  status: AgentStatus;
  permissionCeiling: string;
  lastRanAt: string | null;
  lastResult: string;
  currentWork: string;
};
type Task = {
  id: string;
  title: string;
  domain: string;
  assignedTo: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "BLOCKED" | "FAILED" | "WAITING_APPROVAL";
  priority: string;
  updatedAt: string;
  result: string | null;
  evidence: string[];
  blockedReason: string | null;
  definitionOfDone?: string;
  governance?: {
    risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    scope: "MAINTAIN" | "EXECUTE" | "EXPAND";
    action: "AUTO_PROCEED" | "USER_AUTHORIZED" | "WAIT_FOR_DWIGHT" | "BLOCKED";
    reason: string;
    evaluatedAt: string;
  };
};
type RuntimeEvent = {
  id: string;
  type: string;
  domain: string;
  source: string;
  importance: string;
  occurredAt: string;
  receivedAt: string;
  summary: string;
};

type Objective = {
  id: string;
  title: string;
  domain: string;
  status: "ACTIVE" | "BLOCKED" | "DONE" | "PAUSED";
  successDefinition: string;
  currentFocus: string;
};

type Gap = {
  id: string;
  title: string;
  risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  owner: string;
  status: "ACTIVE" | "PLANNED" | "RESOLVED";
  definitionOfDone: string;
  source: string;
  updatedAt: string;
};

type OperatingSystem = {
  doctrine: string[];
  gaps: Gap[];
  boringQueue: string[];
  governance?: {
    mode: "BALANCED_AUTONOMY";
    standard: string;
    autoProceed: string[];
    askDwightFirst: string[];
    neverWithoutExplicitUnlock: string[];
    changeControl: string;
    scopeControl: string;
    exceptionRule: string;
  };
  chiefOfStaff: {
    meaningfulTasks: number;
    blockedTasks: number;
    killCandidates: number;
    waitingOnDwight: number;
    highestLeverage: string;
    whatAvoiding: string;
  };
  execution: {
    expansionGate: boolean;
    currentFocus: string;
    nextAction: string;
  };
};

type Workforce = {
  status: string;
  lastCycleAt: string | null;
  executiveSummary: string;
  agents: Agent[];
  objectives?: Objective[];
  tasks?: Task[];
  operatingSystem?: OperatingSystem;
  autonomy?: {
    enabled: boolean;
    runId: string | null;
    startedAt: string | null;
    cadenceMinutes: number;
  };
};
type Payload = {
  workforce?: Workforce;
  recentEvents?: RuntimeEvent[];
  counts?: {
    agents: number;
    activeObjectives: number;
    queuedTasks: number;
    runningTasks: number;
    blockedTasks: number;
  };
};

const profiles: Record<string, {
  name: string;
  role: string;
  station: string;
  icon: typeof Bot;
  specialty: string;
  accent: string;
  zone: string;
}> = {
  EXECUTIVE: {
    name: "EXECUTIVE",
    role: "Chief of Staff",
    station: "Command Center",
    icon: BrainCircuit,
    specialty: "Priorities · delegation · approvals",
    accent: "#ef4444",
    zone: "EXECUTIVE WING",
  },
  FINANCE_CFO: {
    name: "CFO",
    role: "Capital Intelligence",
    station: "Capital Desk",
    icon: Landmark,
    specialty: "Cash · debt · leverage · capital",
    accent: "#eab308",
    zone: "CAPITAL WING",
  },
  SENTRYOPS_RESEARCH: {
    name: "RESEARCH",
    role: "SentryOps Intelligence",
    station: "Research Lab",
    icon: Search,
    specialty: "Markets · agencies · competitors",
    accent: "#3b82f6",
    zone: "SENTRYOPS LAB",
  },
  TRADING_OBSERVER: {
    name: "OBSERVER",
    role: "Trading Intelligence",
    station: "Observation Bay",
    icon: Eye,
    specialty: "Setups · execution · behavior",
    accent: "#f97316",
    zone: "MARKET BAY",
  },
  BUILDER: {
    name: "BUILDER",
    role: "Software Engineer",
    station: "Build Lab",
    icon: Code2,
    specialty: "JARVIS · SentryOps · automation",
    accent: "#14b8a6",
    zone: "ENGINEERING",
  },
  JARVIS_QA: {
    name: "QA",
    role: "Quality Watchdog",
    station: "QA Control",
    icon: ShieldCheck,
    specialty: "Failures · evidence · reliability",
    accent: "#a855f7",
    zone: "QA CONTROL",
  },
  IT_INFRA: {
    name: "INFRA",
    role: "Infrastructure / SRE",
    station: "Network Operations",
    icon: ServerCog,
    specialty: "Runtime · uptime · persistence",
    accent: "#22c55e",
    zone: "IT OPERATIONS",
  },
  IT_SECURITY: {
    name: "SECURITY",
    role: "Security Operations",
    station: "Security Operations Center",
    icon: ShieldCheck,
    specialty: "Access · secrets · boundaries",
    accent: "#e11d48",
    zone: "SECURITY",
  },
  IT_INTEGRATIONS: {
    name: "INTEGRATIONS",
    role: "Systems Integration",
    station: "Integration Hub",
    icon: Network,
    specialty: "APIs · connectors · handoffs",
    accent: "#06b6d4",
    zone: "INTEGRATIONS",
  },
};

const officePositions: Record<string, {
  deskX: number;
  deskY: number;
  readyX: number;
  readyY: number;
}> = {
  EXECUTIVE: { deskX: 17, deskY: 21, readyX: 34, readyY: 89 },
  FINANCE_CFO: { deskX: 50, deskY: 19, readyX: 42, readyY: 89 },
  SENTRYOPS_RESEARCH: { deskX: 83, deskY: 21, readyX: 50, readyY: 89 },
  TRADING_OBSERVER: { deskX: 17, deskY: 49, readyX: 58, readyY: 89 },
  BUILDER: { deskX: 50, deskY: 49, readyX: 66, readyY: 89 },
  JARVIS_QA: { deskX: 83, deskY: 49, readyX: 38, readyY: 95 },
  IT_INFRA: { deskX: 17, deskY: 77, readyX: 46, readyY: 95 },
  IT_SECURITY: { deskX: 50, deskY: 77, readyX: 54, readyY: 95 },
  IT_INTEGRATIONS: { deskX: 83, deskY: 77, readyX: 62, readyY: 95 },
}

type OperatorIntent = "ACTIVE" | "PAUSED";

const WORKFORCE_INTENT_KEY = "jarvis-workforce-operator-intent-v1";

function timeAgo(value: string | null) {
  if (!value) return "NEVER";
  const delta = Math.max(0, Date.now() - Date.parse(value));
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "JUST NOW";
  if (minutes < 60) return minutes + "M AGO";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + "H AGO";
  return Math.floor(hours / 24) + "D AGO";
}

function quickEvent(summary: string) {
  const compact = summary.replace(/\s+/g, " ").trim();
  const first = compact.split(/(?<=[.!?])\s+/)[0] || compact;
  return first.length > 96 ? first.slice(0, 93).trimEnd() + "…" : first;
}

export default function WorkforceWorld() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [selectedId, setSelectedId] = useState("EXECUTIVE");
  const [busy, setBusy] = useState(false);
  const [taskText, setTaskText] = useState("");
  const [notice, setNotice] = useState("AUTONOMOUS FLOOR ONLINE");
  const [agentMotion, setAgentMotion] = useState<Record<string, AgentMotion>>({});
  const [operatorIntent, setOperatorIntent] = useState<OperatorIntent | null>(null);
  const operatorIntentRef = useRef<OperatorIntent | null>(null);
  const repairingDurableRun = useRef(false);
  const previousStatuses = useRef<Record<string, AgentStatus>>({});
  const previousFloorActive = useRef<boolean | null>(null);

  function commitOperatorIntent(intent: OperatorIntent) {
    operatorIntentRef.current = intent;
    setOperatorIntent(intent);
    try {
      window.localStorage.setItem(WORKFORCE_INTENT_KEY, intent);
    } catch {
      // Browser storage is a UI latch only; the durable workflow remains server-side.
    }
  }

  async function repairDurableRunIfNeeded(incoming: Payload) {
    if (
      operatorIntentRef.current !== "ACTIVE" ||
      incoming.workforce?.autonomy?.enabled ||
      repairingDurableRun.current
    ) return incoming;

    repairingDurableRun.current = true;
    try {
      const response = await fetch("/api/workforce/always-on?manual=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "START", cadenceMinutes: 15 }),
      });
      const body = await response.json().catch(() => ({})) as { autonomy?: Workforce["autonomy"] };
      if (!response.ok || !body.autonomy) return incoming;
      return incoming.workforce
        ? {
            ...incoming,
            workforce: {
              ...incoming.workforce,
              autonomy: body.autonomy,
            },
          }
        : incoming;
    } finally {
      repairingDurableRun.current = false;
    }
  }

  async function refresh() {
    try {
      const response = await fetch("/api/workforce", { cache: "no-store" });
      if (!response.ok) throw new Error();
      let incoming = (await response.json()) as Payload;

      if (incoming.workforce?.autonomy?.enabled && operatorIntentRef.current !== "PAUSED") {
        commitOperatorIntent("ACTIVE");
      }

      incoming = await repairDurableRunIfNeeded(incoming);
      setPayload(incoming);
    } catch {
      setNotice("WORKFORCE LINK DEGRADED · OPERATOR INTENT PRESERVED");
    }
  }

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(WORKFORCE_INTENT_KEY);
      if (stored === "ACTIVE" || stored === "PAUSED") {
        operatorIntentRef.current = stored;
        setOperatorIntent(stored);
      }
    } catch {
      // No-op: server state still initializes the floor.
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== WORKFORCE_INTENT_KEY) return;
      if (event.newValue === "ACTIVE" || event.newValue === "PAUSED") {
        operatorIntentRef.current = event.newValue;
        setOperatorIntent(event.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 8_000);
    return () => window.clearInterval(timer);
  }, []);

  async function toggleAlwaysOn() {
    if (busy) return;
    setBusy(true);
    const enabled = operatorIntentRef.current === "ACTIVE" || (
      operatorIntentRef.current === null &&
      Boolean(payload?.workforce?.autonomy?.enabled)
    );
    setNotice(enabled ? "PAUSING WORKFORCE · RETURNING TEAM TO READY BAY" : "STARTING DURABLE 24/7 WORKFORCE");
    try {
      const response = await fetch("/api/workforce/always-on?manual=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: enabled ? "STOP" : "START", cadenceMinutes: 15 }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; autonomy?: Workforce["autonomy"] };
      if (!response.ok) throw new Error(body.error || "always-on control failed");
      setPayload((current) => current?.workforce
        ? { ...current, workforce: { ...current.workforce, autonomy: body.autonomy } }
        : current);
      commitOperatorIntent(enabled ? "PAUSED" : "ACTIVE");
      setNotice(enabled ? "WORKFORCE PAUSED · TEAM RETURNING TO READY BAY" : "DURABLE 24/7 WORKFORCE ACTIVE · OPERATOR LOCKED");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message.toUpperCase() : "ALWAYS-ON CONTROL FAILED");
    } finally {
      setBusy(false);
    }
  }

  async function runCycle() {
    if (busy) return;
    setBusy(true);
    const serverAlwaysOn = Boolean(payload?.workforce?.autonomy?.enabled);
    const visuallyActive = operatorIntentRef.current === "ACTIVE" || (
      operatorIntentRef.current === null && serverAlwaysOn
    );
    setNotice(visuallyActive ? "RUNNING IMMEDIATE TEAM CYCLE" : "STARTING TEAM · DURABLE OPERATIONS ENGAGING");
    try {
      if (!serverAlwaysOn) {
        const startResponse = await fetch("/api/workforce/always-on?manual=1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "START", cadenceMinutes: 15 }),
        });
        const startBody = await startResponse.json().catch(() => ({})) as { error?: string; autonomy?: Workforce["autonomy"] };
        if (!startResponse.ok) throw new Error(startBody.error || "workforce start failed");
        setPayload((current) => current?.workforce
          ? { ...current, workforce: { ...current.workforce, autonomy: startBody.autonomy } }
          : current);
        commitOperatorIntent("ACTIVE");
        setNotice("TEAM ACTIVE · OPERATOR LOCKED UNTIL PAUSE");
        await refresh();
        return;
      }

      const response = await fetch("/api/workforce?manual=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RUN_CYCLE" }),
      });
      const body = await response.json().catch(() => ({})) as Payload & { error?: string };
      if (!response.ok) throw new Error(body.error || "cycle failed");
      setPayload((current) => ({ ...current, workforce: body.workforce }));
      commitOperatorIntent("ACTIVE");
      setNotice("IMMEDIATE TEAM CYCLE COMPLETE · 24/7 OPERATIONS REMAIN ACTIVE");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message.toUpperCase() : "CYCLE FAILED");
    } finally {
      setBusy(false);
    }
  }

  async function assignTask(event: FormEvent) {
    event.preventDefault();
    const title = taskText.trim();
    if (!title || busy) return;
    setBusy(true);
    setNotice("ASSIGNING WORK");
    try {
      const response = await fetch("/api/workforce?manual=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ADD_TASK",
          title,
          assignedTo: selectedId,
          priority: "HIGH",
          permissionRequired: selectedId === "TRADING_OBSERVER" ? "READ" : selectedId === "BUILDER" ? "WRITE_INTERNAL" : "ANALYZE",
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "assignment failed");
      setTaskText("");
      setNotice("TASK ASSIGNED");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message.toUpperCase() : "ASSIGNMENT FAILED");
    } finally {
      setBusy(false);
    }
  }

  const workforce = payload?.workforce;
  const agents = workforce?.agents ?? [];
  const objectives = workforce?.objectives ?? [];
  const tasks = workforce?.tasks ?? [];
  const operatingSystem = workforce?.operatingSystem;
  const gaps = operatingSystem?.gaps ?? [];
  const activeGaps = gaps.filter((gap) => gap.status !== "RESOLVED").slice(0, 6);
  const boringQueue = operatingSystem?.boringQueue ?? [];
  const doctrine = operatingSystem?.doctrine ?? [
    "See the mission.",
    "Find the gaps.",
    "Do the necessary work.",
    "Close the loop.",
    "Verify the result.",
    "Then expand.",
  ];
  const selected = agents.find((agent) => agent.id === selectedId) ?? agents[0] ?? null;
  const selectedProfile = selected ? profiles[selected.id] : null;
  const selectedTasks = useMemo(
    () => selected ? tasks.filter((task) => task.assignedTo === selected.id) : [],
    [selected, tasks],
  );
  const openTasks = tasks.filter((task) => ["QUEUED", "RUNNING", "BLOCKED", "WAITING_APPROVAL"].includes(task.status));
  const completed = tasks.filter((task) => task.status === "DONE").length;
  const queueTasks = useMemo(() => {
    const source = selectedTasks.length ? selectedTasks : tasks;
    const active = source
      .filter((task) => ["QUEUED", "RUNNING", "BLOCKED", "WAITING_APPROVAL"].includes(task.status))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const complete = source
      .filter((task) => task.status === "DONE")
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const failedHistory = source
      .filter((task) => task.status === "FAILED")
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return [...active, ...complete, ...failedHistory].slice(0, 8);
  }, [selectedTasks, tasks]);
  const workNow = useMemo(() => {
    const statusRank: Record<Task["status"], number> = {
      RUNNING: 0,
      QUEUED: 1,
      BLOCKED: 2,
      WAITING_APPROVAL: 3,
      DONE: 4,
      FAILED: 5,
    };
    return agents.map((agent) => {
      const activeTask = tasks
        .filter((task) =>
          task.assignedTo === agent.id &&
          ["RUNNING", "QUEUED", "BLOCKED", "WAITING_APPROVAL"].includes(task.status)
        )
        .sort((a, b) => statusRank[a.status] - statusRank[b.status] || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null;
      return { agent, activeTask };
    });
  }, [agents, tasks]);
  const completedWork = useMemo(
    () => tasks
      .filter((task) => task.status === "DONE")
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, 8),
    [tasks],
  );
  const recentFailures = useMemo(
    () => tasks
      .filter((task) => task.status === "FAILED")
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, 3),
    [tasks],
  );
  const governance = operatingSystem?.governance;
  const recentEvents = payload?.recentEvents ?? [];
  const teamComms = recentEvents
    .filter((event) => event.type === "workforce.handoff")
    .slice(0, 8);
  const workProof = recentEvents
    .filter((event) =>
      event.type !== "workforce.handoff" &&
      (event.type.startsWith("workforce.") ||
       event.type.startsWith("finance.") ||
       event.type.startsWith("research.") ||
       event.type.startsWith("trading."))
    )
    .slice(0, 8);
  const indicatorEvidence = recentEvents.find((event) => event.type === "trading.indicator_evidence") ?? null;
  const serverFloorActive = Boolean(workforce?.autonomy?.enabled);
  const floorActive = operatorIntent === "ACTIVE" || (
    operatorIntent === null && serverFloorActive
  );

  const agentIdsKey = agents.map((agent) => agent.id).join("|");

  useEffect(() => {
    previousStatuses.current = Object.fromEntries(agents.map((agent) => [agent.id, agent.status]));
  }, [agents]);

  useEffect(() => {
    if (!agents.length) return;
    const timers: number[] = [];
    const wasActive = previousFloorActive.current;

    if (wasActive === null) {
      setAgentMotion(Object.fromEntries(agents.map((agent) => [
        agent.id,
        floorActive
          ? agent.status === "BLOCKED" ? "BLOCKED"
          : agent.status === "ERROR" ? "ERROR"
          : "SEATED"
          : "READY",
      ])));
      previousFloorActive.current = floorActive;
      return;
    }

    if (floorActive === wasActive) return;

    if (floorActive) {
      setAgentMotion(Object.fromEntries(agents.map((agent) => [agent.id, "WALKING" as AgentMotion])));
      agents.forEach((agent, index) => {
        timers.push(window.setTimeout(() => {
          const latestStatus = previousStatuses.current[agent.id];
          setAgentMotion((state) => ({
            ...state,
            [agent.id]:
              latestStatus === "BLOCKED" ? "BLOCKED" :
              latestStatus === "ERROR" ? "ERROR" :
              "SEATED",
          }));
        }, 2600 + index * 70));
      });
    } else {
      setAgentMotion(Object.fromEntries(agents.map((agent) => [agent.id, "RETURNING" as AgentMotion])));
      agents.forEach((agent, index) => {
        timers.push(window.setTimeout(() => {
          setAgentMotion((state) => ({ ...state, [agent.id]: "READY" }));
        }, 2400 + index * 55));
      });
    }

    previousFloorActive.current = floorActive;
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [floorActive, agentIdsKey]);

  useEffect(() => {
    if (!floorActive || !agents.length) return;
    setAgentMotion((current) => {
      const next = { ...current };
      for (const agent of agents) {
        const motion = current[agent.id];
        if (motion === "WALKING" || motion === "RETURNING") continue;
        next[agent.id] =
          agent.status === "BLOCKED" ? "BLOCKED" :
          agent.status === "ERROR" ? "ERROR" :
          "SEATED";
      }
      return next;
    });
  }, [agents, floorActive]);



  return (
    <main className={styles.page}>
      <div className={styles.grid} />
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.brandIcon}><Building2 size={19} /></div>
          <div>
            <strong>JARVIS // AI WORKFORCE</strong>
            <span>HIMIE JOHNSON VENTURES · $100M OPERATING STANDARD · AUTONOMOUS OPERATIONS FLOOR</span>
          </div>
        </div>
        <div className={styles.headerStats}>
          <Stat label="EMPLOYEES" value={String(agents.length || 9)} />
          <Stat label="OPEN WORK" value={String(openTasks.length)} />
          <Stat label="COMPLETE" value={String(completed)} />
          <Stat label="HEARTBEAT" value={floorActive ? ((workforce?.autonomy?.cadenceMinutes ?? 15) + "M") : "OFF"} />
        </div>
        <Link href="/work" className={styles.coreLink}><BrainCircuit size={13} /> JARVIS CORE <ChevronRight size={12} /></Link>
      </header>

      <section className={styles.commandStrip}>
        <div>
          <span className={styles.liveDot} />
          <strong>{notice}</strong>
          <small>DURABLE WORKFLOW · 15M OPERATING CYCLE · DEEP RESEARCH THROTTLED TO ≤ 4H · EVENT/MANUAL RUNS AVAILABLE</small>
        </div>
        <div className={styles.commandActions}>
          <button onClick={toggleAlwaysOn} disabled={busy} className={floorActive ? styles.alwaysOn : ""}>
            <CircleDot size={11} /> {floorActive ? "PAUSE WORKFORCE" : "START 24/7"}
          </button>
          <button onClick={runCycle} disabled={busy}><Play size={12} /> {busy ? "WORKING" : (floorActive ? "RUN TEAM NOW" : "RUN + KEEP ACTIVE")}</button>
        </div>
      </section>

      <section className={styles.floor}>
        <div className={styles.floorHead}>
          <div>
            <span>OPERATIONS FLOOR</span>
            <strong>HIMIE JOHNSON VENTURES // LIVE AI OPERATIONS</strong>
          </div>
          <small>TOP OFFICE VIEW · PEOPLE MOVE WHEN REAL WORK STARTS</small>
        </div>

        <div className={styles.worldShell}>
          <div className={styles.worldRibbon}>
            <span><i className={styles.dotWorking} /> SEATED + WORKING</span>
            <span><i className={styles.dotReady} /> READY BAY</span>
            <span><i className={styles.dotBlocked} /> BLOCKED / INCIDENT</span>
            <b>{floorActive
              ? "OPERATOR LOCK: ACTIVE · CLICK / ZOOM / REFRESH CANNOT PAUSE THE TEAM"
              : "PAUSED BY OPERATOR · START = WALK TO DESKS"}</b>
          </div>

          <div className={styles.simFloor}>
            <div className={styles.simFloorPlane} />
            <div className={styles.glassNorthWall} />
            <div className={styles.centralAisle} />
            <div className={styles.crossAisle} />

            <div className={styles.jarvisOverlook}>
              <div className={styles.jarvisOrb}><BrainCircuit size={16} /></div>
              <div><strong>JARVIS</strong><small>COMMAND OVERLOOK</small></div>
            </div>

            <div className={styles.readyBay}>
              <strong>READY BAY</strong>
              <small>IDLE EMPLOYEES WAIT HERE UNTIL WORK IS ASSIGNED</small>
            </div>

            {agents.map((agent, index) => {
              const profile = profiles[agent.id] ?? {
                name: agent.id,
                role: agent.domain,
                station: "Operations",
                icon: Bot,
                specialty: agent.currentWork,
                accent: "#94a3b8",
                zone: "OPERATIONS",
              };
              const Icon = profile.icon;
              const pos = officePositions[agent.id] ?? {
                deskX: 16 + (index % 3) * 34,
                deskY: 22 + Math.floor(index / 3) * 28,
                readyX: 10 + index * 10,
                readyY: 91,
              };
              return (
                <button
                  type="button"
                  key={"desk-" + agent.id}
                  className={
                    styles.deskPod +
                    " " + styles[agent.status.toLowerCase()] +
                    (floorActive && agent.status !== "BLOCKED" && agent.status !== "ERROR" ? " " + styles.operating : "") +
                    (selectedId === agent.id ? " " + styles.selectedDeskPod : "")
                  }
                  style={{
                    "--agent-accent": profile.accent,
                    "--desk-x": pos.deskX + "%",
                    "--desk-y": pos.deskY + "%",
                  } as CSSProperties}
                  onClick={() => setSelectedId(agent.id)}
                >
                  <div className={styles.deskLabel}>
                    <span>{profile.zone}</span>
                    <b>{String(index + 1).padStart(2, "0")}</b>
                  </div>
                  <div className={styles.isometricDesk}>
                    <span className={styles.deskSurface} />
                    <span className={styles.deskFace} />
                    <span className={styles.deskSide} />
                    <span className={styles.deskFootA} />
                    <span className={styles.deskFootB} />
                    <span className={styles.chairBase} />
                    <span className={styles.chairBack} />
                  </div>
                  <div className={styles.deskScreens}>
                    <span className={styles.screenPrimary}><i /><i /><i /><i /></span>
                    <span className={styles.screenSecondary}><i /><i /><i /></span>
                  </div>
                  <div className={styles.deskIdentity}>
                    <Icon size={11} />
                    <div><strong>{profile.name}</strong><small>{profile.station}</small></div>
                  </div>
                  <div className={styles.workSignal}>
                    <i />
                    <span>{
                      !floorActive ? "STANDBY" :
                      agent.status === "BLOCKED" ? "WAITING" :
                      agent.status === "ERROR" ? "INCIDENT" :
                      agent.status === "RUNNING" ? "WORKING" :
                      agent.status === "DONE" ? "MONITORING" :
                      "ON DUTY"
                    }</span>
                  </div>
                  {floorActive && agent.status !== "ERROR" ? (
                    <div className={styles.activeTaskRibbon}>{agent.currentWork || profile.specialty}</div>
                  ) : null}
                </button>
              );
            })}

            <div className={styles.peopleLayer}>
              {agents.map((agent, index) => {
                const profile = profiles[agent.id] ?? {
                  name: agent.id,
                  role: agent.domain,
                  station: "Operations",
                  icon: Bot,
                  specialty: agent.currentWork,
                  accent: "#94a3b8",
                  zone: "OPERATIONS",
                };
                const pos = officePositions[agent.id] ?? {
                  deskX: 16 + (index % 3) * 34,
                  deskY: 22 + Math.floor(index / 3) * 28,
                  readyX: 10 + index * 10,
                  readyY: 91,
                };
                const motion = agentMotion[agent.id] ??
                  (!floorActive ? "READY" :
                   agent.status === "BLOCKED" ? "BLOCKED" :
                   agent.status === "ERROR" ? "ERROR" :
                   "SEATED");

                return (
                  <button
                    type="button"
                    key={"person-" + agent.id}
                    className={
                      styles.simPerson +
                      " " + styles["motion" + motion] +
                      (selectedId === agent.id ? " " + styles.selectedPerson : "")
                    }
                    style={{
                      "--agent-accent": profile.accent,
                      "--desk-x": pos.deskX + "%",
                      "--desk-y": (pos.deskY + 3.2) + "%",
                      "--ready-x": pos.readyX + "%",
                      "--ready-y": pos.readyY + "%",
                      "--walk-delay": (index * 70) + "ms",
                    } as CSSProperties}
                    onClick={() => setSelectedId(agent.id)}
                    title={profile.name + " · " + motion}
                  >
                    <span className={styles.personShadow} />
                    <span className={styles.personLegLeft} />
                    <span className={styles.personLegRight} />
                    <span className={styles.personTorso} />
                    <span className={styles.personArmLeft} />
                    <span className={styles.personArmRight} />
                    <span className={styles.personHead}><i /></span>
                    <span className={styles.personHair} />
                    <span className={styles.personName}>{profile.name}</span>
                    {motion === "WALKING" ? <span className={styles.personAction}>WALKING TO DESK</span> : null}
                    {motion === "RETURNING" ? <span className={styles.personAction}>RETURNING TO READY BAY</span> : null}
                    {motion === "SEATED" ? <span className={styles.personAction}>WORKING</span> : null}
                    {motion === "BLOCKED" ? <span className={styles.personAction}>BLOCKED</span> : null}
                    {motion === "ERROR" ? <span className={styles.personAction}>INCIDENT</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className={styles.workVisibility}>
        <div className={styles.workVisibilityHead}>
          <div>
            <span>EXECUTION VISIBILITY</span>
            <strong>WHAT THE TEAM IS DOING // WHAT THE TEAM FINISHED</strong>
          </div>
          <small>{floorActive ? "LIVE COMPANY VIEW" : "PAUSED · LAST KNOWN STATE"}</small>
        </div>

        <div className={styles.workVisibilityGrid}>
          <div className={styles.nowPanel}>
            <div className={styles.panelTitle}><Activity size={14} /><span>WORKING NOW</span><small>{workNow.length} AGENTS</small></div>
            <div className={styles.nowList}>
              {workNow.map(({ agent, activeTask }) => {
                const profile = profiles[agent.id] ?? { name: agent.id };
                const displayStatus = !floorActive
                  ? "OFF DUTY"
                  : activeTask?.status === "RUNNING"
                    ? "RUNNING"
                    : activeTask?.status === "BLOCKED"
                      ? "BLOCKED"
                      : activeTask?.status === "WAITING_APPROVAL"
                        ? "WAITING ON DWIGHT"
                        : activeTask?.status === "QUEUED"
                          ? "NEXT UP"
                          : agent.status === "ERROR"
                            ? "INCIDENT"
                            : "MONITORING";
                return (
                  <button className={styles.nowRow} key={agent.id} onClick={() => setSelectedId(agent.id)}>
                    <i style={{ "--agent-accent": profiles[agent.id]?.accent ?? "#94a3b8" } as CSSProperties} />
                    <div>
                      <strong>{profile.name}</strong>
                      <span>{activeTask?.title ?? agent.currentWork}</span>
                    </div>
                    <b>{displayStatus}</b>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={styles.donePanel}>
            <div className={styles.panelTitle}><ShieldCheck size={14} /><span>COMPLETED WORK</span><small>{completedWork.length} RECENT</small></div>
            <div className={styles.doneList}>
              {completedWork.map((task) => (
                <div className={styles.doneRow} key={task.id}>
                  <i />
                  <div>
                    <strong>{task.title}</strong>
                    <span>{task.assignedTo} · {timeAgo(task.updatedAt)} · {task.evidence.length} EVIDENCE</span>
                    <small>{quickEvent(task.result ?? "Completed outcome recorded.")}</small>
                  </div>
                  <b>DONE</b>
                </div>
              ))}
              {!completedWork.length ? <div className={styles.empty}>NO COMPLETED OUTCOMES RECORDED YET</div> : null}
            </div>
            {recentFailures.length ? (
              <div className={styles.failureStrip}>
                <span>RECENT FAILED WORK</span>
                <b>{recentFailures.map((task) => task.title).join(" · ")}</b>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className={styles.commandDeck}>
        <div className={styles.commandMain}>
          <div className={styles.lowerGrid}>
            <div className={styles.detailPanel}>
              <div className={styles.panelTitle}><TerminalSquare size={14} /><span>EMPLOYEE TERMINAL</span><small>{selectedProfile?.station ?? "SELECT AGENT"}</small></div>
              {selected && selectedProfile ? (
                <>
                  <div className={styles.employeeHead}>
                    <div className={styles.employeeBadge}>{selectedProfile.name.slice(0, 2)}</div>
                    <div>
                      <strong>{selectedProfile.name}</strong>
                      <span>{selectedProfile.role}</span>
                      <small>{selected.domain} · PERMISSION {selected.permissionCeiling}</small>
                    </div>
                    <div className={styles.employeeStatus}><CircleDot size={11} /> {selected.status}</div>
                  </div>
                  <div className={styles.employeeWork}>
                    <label>CURRENT OUTCOME</label>
                    <p>{selected.currentWork}</p>
                    <label>LAST VERIFIED RESULT · {timeAgo(selected.lastRanAt)}</label>
                    <p>{selected.lastResult}</p>
                  </div>
                  <form className={styles.assign} onSubmit={assignTask}>
                    <input
                      value={taskText}
                      onChange={(event) => setTaskText(event.target.value)}
                      placeholder={"Assign outcome to " + selectedProfile.name + "..."}
                    />
                    <button disabled={busy || !taskText.trim()}>ASSIGN</button>
                  </form>
                </>
              ) : <div className={styles.empty}>WAITING FOR WORKFORCE STATE</div>}
            </div>

            <div className={styles.queuePanel}>
              <div className={styles.panelTitle}><Activity size={14} /><span>OUTCOME QUEUE</span><small>{openTasks.length} OPEN</small></div>
              <div className={styles.queue}>
                {queueTasks.map((task) => (
                  <div className={styles.task} key={task.id}>
                    <i className={styles["task" + task.status]} />
                    <div>
                      <strong>{task.title}</strong>
                      <span>{task.assignedTo} · {task.priority} · {task.domain}</span>
                      {task.governance ? (
                        <mark className={styles.governanceTag}>
                          {task.governance.action.replace(/_/g, " ")} · {task.governance.scope} · {task.governance.risk}
                        </mark>
                      ) : null}
                      {task.definitionOfDone ? <em>DONE WHEN: {task.definitionOfDone}</em> : null}
                      {task.result ? <small>{task.result}</small> : task.blockedReason ? <small>{task.blockedReason}</small> : null}
                    </div>
                    <b>{task.status}</b>
                  </div>
                ))}
                {!tasks.length ? <div className={styles.empty}>NO TASK HISTORY YET · RUN THE FIRST WORKFORCE CYCLE</div> : null}
              </div>
            </div>
          </div>

          <div className={styles.missionGrid}>
            <div className={styles.missionPanel}>
              <div className={styles.panelTitle}><BrainCircuit size={14} /><span>OPERATING DOCTRINE</span><small>MISSION FIRST</small></div>
              <div className={styles.doctrineFlow}>
                {doctrine.map((line, index) => (
                  <div key={line}><b>{String(index + 1).padStart(2, "0")}</b><span>{line}</span></div>
                ))}
              </div>
              <div className={styles.executionMode}>
                <span>EXECUTION MODE</span>
                <strong>{operatingSystem?.execution.expansionGate ? "CLOSE GAPS BEFORE EXPANSION" : "ADVANCE HIGHEST-LEVERAGE OBJECTIVE"}</strong>
                <p>{operatingSystem?.execution.currentFocus ?? "Complete the current mission, verify it, then expand."}</p>
              </div>
            </div>

            <div className={styles.gapPanel}>
              <div className={styles.panelTitle}><Search size={14} /><span>GAP LEDGER</span><small>{activeGaps.length} OPEN</small></div>
              <div className={styles.gapList}>
                {activeGaps.map((gap) => (
                  <div className={styles.gapRow} key={gap.id}>
                    <i className={styles["risk" + gap.risk]} />
                    <div><strong>{gap.title}</strong><span>{gap.owner} · {gap.risk} · {gap.status}</span></div>
                  </div>
                ))}
                {!activeGaps.length ? <div className={styles.empty}>NO ACTIVE GAPS DETECTED FROM CURRENT WORKFORCE EVIDENCE</div> : null}
              </div>
            </div>

            <div className={styles.boringPanel}>
              <div className={styles.panelTitle}><ShieldCheck size={14} /><span>UNGLAMOROUS BUT NECESSARY</span><small>CLOSE LOOPS</small></div>
              <div className={styles.boringList}>
                {boringQueue.slice(0, 6).map((item) => <div key={item}><CircleDot size={8} /><span>{item}</span></div>)}
              </div>
            </div>
          </div>

          <div className={styles.governancePanel}>
            <div className={styles.panelTitle}><ShieldCheck size={14} /><span>AUTONOMY CHARTER</span><small>{governance?.mode ?? "BALANCED_AUTONOMY"}</small></div>
            <div className={styles.governanceStandard}>
              <strong>{governance?.standard ?? "Autonomous enough to continue the mission; restrained enough not to invent a new mission."}</strong>
              <span>{governance?.changeControl ?? "Reproduce → diagnose → smallest effective change → test → QA → observe."}</span>
            </div>
            <div className={styles.governanceColumns}>
              <div className={styles.governanceAllow}>
                <b>AUTO-PROCEED</b>
                {(governance?.autoProceed ?? [
                  "Low-risk reversible work inside approved objectives",
                  "Testing, research, monitoring, cleanup, validation, documentation",
                ]).map((item) => <span key={item}>{item}</span>)}
              </div>
              <div className={styles.governanceAsk}>
                <b>ASK DWIGHT FIRST</b>
                {(governance?.askDwightFirst ?? [
                  "Major scope expansion or redesign",
                  "External, financial, production-risk, or permission changes",
                ]).map((item) => <span key={item}>{item}</span>)}
              </div>
              <div className={styles.governanceNever}>
                <b>HARD LIMIT</b>
                {(governance?.neverWithoutExplicitUnlock ?? [
                  "Live trade execution or unrestricted money movement",
                  "Bypassing approvals, exposing secrets, or self-expanding permissions",
                ]).map((item) => <span key={item}>{item}</span>)}
              </div>
            </div>
            <div className={styles.governanceFooter}>
              <span>SCOPE: {governance?.scopeControl ?? "Vision can expand; autonomous execution stays inside approved missions."}</span>
              <span>EXCEPTION: {governance?.exceptionRule ?? "Dwight may explicitly authorize expansion; hard permission boundaries remain."}</span>
            </div>
          </div>
        </div>

        <aside className={styles.rightRail}>
          <div className={styles.execPanel}>
            <div className={styles.panelTitle}><BriefcaseBusiness size={14} /><span>CHIEF OF STAFF</span><small>{workforce?.status ?? "STARTING"}</small></div>
            <p>{workforce?.executiveSummary ?? "JARVIS is preparing the workforce operating picture."}</p>
            <div className={styles.cosNumbers}>
              <div><span>MEANINGFUL</span><strong>{operatingSystem?.chiefOfStaff.meaningfulTasks ?? 0}</strong></div>
              <div><span>BLOCKED</span><strong>{operatingSystem?.chiefOfStaff.blockedTasks ?? 0}</strong></div>
              <div><span>KILL / REVIEW</span><strong>{operatingSystem?.chiefOfStaff.killCandidates ?? 0}</strong></div>
              <div><span>WAITING ON YOU</span><strong>{operatingSystem?.chiefOfStaff.waitingOnDwight ?? 0}</strong></div>
            </div>
            <div className={styles.cosFocus}>
              <span>HIGHEST LEVERAGE</span>
              <strong>{operatingSystem?.chiefOfStaff.highestLeverage ?? "Close the highest-risk open loop."}</strong>
            </div>
            <div className={styles.avoidance}>
              <span>WHAT ARE WE AVOIDING?</span>
              <p>{operatingSystem?.chiefOfStaff.whatAvoiding ?? "No critical avoidance signal detected yet."}</p>
            </div>
          </div>

          <div className={styles.eventPanel}>
            <div className={styles.panelTitle}><Activity size={14} /><span>EVENT BRIEFINGS</span><small>QUICK</small></div>
            <div className={styles.eventBriefs}>
              {(recentEvents.length ? recentEvents.slice(0, 9) : [{
                id: "no-events",
                type: "workforce.waiting",
                domain: "CORE",
                source: "jarvis",
                importance: "BACKGROUND",
                occurredAt: new Date(0).toISOString(),
                receivedAt: new Date(0).toISOString(),
                summary: "No new operations events yet.",
              }]).map((event) => (
                <div key={event.id}>
                  <i />
                  <div>
                    <b>{event.type.replace(/[._]/g, " ").toUpperCase()}</b>
                    <span>{quickEvent(event.summary)}</span>
                  </div>
                  <small>{event.id === "no-events" ? "—" : timeAgo(event.occurredAt)}</small>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.indicatorRail}>
            <div className={styles.panelTitle}><Eye size={14} /><span>TRADING LEARNING LOOP</span><small>{indicatorEvidence ? "EVIDENCE IN" : "ARMED"}</small></div>
            <div className={styles.indicatorRailFlow}>
              <span>OBSERVER</span><i>→</i><span>PICTURES + NOTES</span><i>→</i><span>BUILDER + QA</span>
            </div>
            <p>{indicatorEvidence
              ? quickEvent(indicatorEvidence.summary)
              : "Waiting for enough trading evidence to justify a testable indicator change."}</p>
            <small>BASELINE LOCKED · VERSION CHANGES ONLY AFTER EVIDENCE + QA</small>
          </div>

          <div className={styles.objectivesPanel}>
            <div className={styles.panelTitle}><Landmark size={14} /><span>ACTIVE MISSIONS</span><small>{objectives.filter((item) => item.status === "ACTIVE").length}</small></div>
            {objectives.filter((item) => item.status === "ACTIVE").slice(0, 4).map((objective) => (
              <div className={styles.objectiveMini} key={objective.id}>
                <strong>{objective.title}</strong>
                <span>{objective.currentFocus}</span>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className={styles.stat}><span>{label}</span><strong>{value}</strong></div>;
}
