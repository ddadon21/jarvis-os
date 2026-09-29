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

type Workforce = {
  status: string;
  lastCycleAt: string | null;
  executiveSummary: string;
  agents: Agent[];
  tasks?: Task[];
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
  const tasks = workforce?.tasks ?? [];
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

      <section className={styles.opsProof}>
        <div className={styles.opsProofHead}>
          <div>
            <span>HJV OPERATIONS COMMS</span>
            <strong>{floorActive ? "TEAM ONLINE · COLLABORATING" : "TEAM OFF DUTY · READY BAY"}</strong>
          </div>
          <div className={styles.opsProofStatus}>
            <i className={floorActive ? styles.opsLive : styles.opsQuiet} />
            <b>{floorActive ? "CONTINUES UNTIL YOU PAUSE" : "PAUSED"}</b>
          </div>
        </div>

        <div className={styles.opsProofGrid}>
          <div className={styles.commsPanel}>
            <div className={styles.opsPanelTitle}>
              <Network size={12} />
              <span>TEAM HANDOFFS</span>
              <small>{teamComms.length ? "LIVE" : "WAITING"}</small>
            </div>
            <div className={styles.opsStream}>
              {(teamComms.length ? teamComms : [{
                id: "no-handoffs",
                type: "workforce.handoff",
                domain: "CORE",
                source: "jarvis.handoff",
                importance: "BACKGROUND",
                occurredAt: new Date(0).toISOString(),
                receivedAt: new Date(0).toISOString(),
                summary: floorActive
                  ? "Agents are online. Handoffs will appear here as specialist work moves between departments."
                  : "Start the workforce to begin live department handoffs.",
              }]).map((event) => (
                <div className={styles.opsLine} key={event.id}>
                  <i />
                  <div>
                    <b>{event.summary.includes(":") ? event.summary.split(":")[0] : event.domain}</b>
                    <span>{event.summary.includes(":") ? event.summary.slice(event.summary.indexOf(":") + 1).trim() : event.summary}</span>
                  </div>
                  <small>{event.id === "no-handoffs" ? "—" : timeAgo(event.occurredAt)}</small>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.commsPanel}>
            <div className={styles.opsPanelTitle}>
              <Activity size={12} />
              <span>PROOF OF WORK</span>
              <small>{workProof.length ? "ACTIVITY" : "STANDBY"}</small>
            </div>
            <div className={styles.opsStream}>
              {(workProof.length ? workProof : [{
                id: "no-proof",
                type: "workforce.waiting",
                domain: "CORE",
                source: "jarvis.workforce",
                importance: "BACKGROUND",
                occurredAt: new Date(0).toISOString(),
                receivedAt: new Date(0).toISOString(),
                summary: "No new completed work has been recorded yet.",
              }]).map((event) => (
                <div className={styles.opsLine} key={event.id}>
                  <i />
                  <div>
                    <b>{event.type.replace(/[._]/g, " ").toUpperCase()}</b>
                    <span>{event.summary}</span>
                  </div>
                  <small>{event.id === "no-proof" ? "—" : timeAgo(event.occurredAt)}</small>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.indicatorLabPanel}>
            <div className={styles.opsPanelTitle}>
              <Eye size={12} />
              <span>TRADING LEARNING LOOP</span>
              <small>{indicatorEvidence ? "EVIDENCE IN" : "ARMED"}</small>
            </div>
            <div className={styles.indicatorFlow}>
              <div><b>01</b><span>OBSERVER</span><small>live execution evidence</small></div>
              <i>→</i>
              <div><b>02</b><span>JOURNAL VISION</span><small>pictures + notes</small></div>
              <i>→</i>
              <div><b>03</b><span>BUILDER + QA</span><small>test indicator hypotheses</small></div>
            </div>
            <p>{indicatorEvidence
              ? indicatorEvidence.summary
              : "The indicator baseline stays unchanged until real trading evidence arrives. New trade pictures and notes are now routed into the same learning loop as Observer evidence."}</p>
            <small className={styles.baselineLock}>BASELINE LOCKED · NEW CODE MUST BE VERSIONED + EVIDENCE-BACKED</small>
          </div>
        </div>
      </section>

      <section className={styles.lowerGrid}>
        <div className={styles.detailPanel}>
          <div className={styles.panelTitle}><TerminalSquare size={13} /><span>EMPLOYEE TERMINAL</span><small>{selectedProfile?.station ?? "SELECT AGENT"}</small></div>
          {selected && selectedProfile ? (
            <>
              <div className={styles.employeeHead}>
                <div className={styles.employeeBadge}>{selectedProfile.name.slice(0, 2)}</div>
                <div>
                  <strong>{selectedProfile.name}</strong>
                  <span>{selectedProfile.role}</span>
                  <small>{selected.domain} · PERMISSION {selected.permissionCeiling}</small>
                </div>
                <div className={styles.employeeStatus}><CircleDot size={10} /> {selected.status}</div>
              </div>
              <div className={styles.employeeWork}>
                <label>CURRENT WORK</label>
                <p>{selected.currentWork}</p>
                <label>LAST RESULT · {timeAgo(selected.lastRanAt)}</label>
                <p>{selected.lastResult}</p>
              </div>
              <form className={styles.assign} onSubmit={assignTask}>
                <input
                  value={taskText}
                  onChange={(event) => setTaskText(event.target.value)}
                  placeholder={"Assign work to " + selectedProfile.name + "..."}
                />
                <button disabled={busy || !taskText.trim()}>ASSIGN</button>
              </form>
            </>
          ) : <div className={styles.empty}>WAITING FOR WORKFORCE STATE</div>}
        </div>

        <div className={styles.queuePanel}>
          <div className={styles.panelTitle}><Activity size={13} /><span>WORK QUEUE</span><small>{openTasks.length} OPEN</small></div>
          <div className={styles.queue}>
            {queueTasks.map((task) => (
              <div className={styles.task} key={task.id}>
                <i className={styles["task" + task.status]} />
                <div>
                  <strong>{task.title}</strong>
                  <span>{task.assignedTo} · {task.priority} · {task.domain}</span>
                  {task.result ? <small>{task.result}</small> : task.blockedReason ? <small>{task.blockedReason}</small> : null}
                </div>
                <b>{task.status}</b>
              </div>
            ))}
            {!tasks.length ? <div className={styles.empty}>NO TASK HISTORY YET · RUN THE FIRST WORKFORCE CYCLE</div> : null}
          </div>
        </div>

        <div className={styles.execPanel}>
          <div className={styles.panelTitle}><BriefcaseBusiness size={13} /><span>EXECUTIVE BRIEF</span><small>{workforce?.status ?? "STARTING"}</small></div>
          <p>{workforce?.executiveSummary ?? "JARVIS is preparing the workforce operating picture."}</p>
          <div className={styles.protocols}>
            <div><span>EXTERNAL ACTIONS</span><strong>APPROVAL-GATED</strong></div>
            <div><span>TRADING EXECUTION</span><strong>DISABLED</strong></div>
            <div><span>QA REVIEW</span><strong>MANDATORY</strong></div>
            <div><span>STATE</span><strong>SUPABASE</strong></div>
          </div>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className={styles.stat}><span>{label}</span><strong>{value}</strong></div>;
}
