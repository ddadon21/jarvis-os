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
import { FormEvent, useEffect, useMemo, useState, type CSSProperties } from "react";
import styles from "./workforce-world.module.css";

type AgentStatus = "IDLE" | "RUNNING" | "DONE" | "BLOCKED" | "ERROR";
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

  async function refresh() {
    try {
      const response = await fetch("/api/workforce", { cache: "no-store" });
      if (!response.ok) throw new Error();
      setPayload((await response.json()) as Payload);
    } catch {
      setNotice("WORKFORCE LINK DEGRADED");
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 8_000);
    return () => window.clearInterval(timer);
  }, []);

  async function toggleAlwaysOn() {
    if (busy) return;
    setBusy(true);
    const enabled = Boolean(payload?.workforce?.autonomy?.enabled);
    setNotice(enabled ? "STOPPING DURABLE WORKFORCE" : "STARTING DURABLE 24/7 WORKFORCE");
    try {
      const response = await fetch("/api/workforce/always-on?manual=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: enabled ? "STOP" : "START", cadenceMinutes: 60 }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; autonomy?: Workforce["autonomy"] };
      if (!response.ok) throw new Error(body.error || "always-on control failed");
      setPayload((current) => current?.workforce
        ? { ...current, workforce: { ...current.workforce, autonomy: body.autonomy } }
        : current);
      setNotice(enabled ? "DURABLE WORKFORCE STOP REQUESTED" : "DURABLE 24/7 WORKFORCE ACTIVE");
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
    setNotice("WORKFORCE CYCLE IN PROGRESS");
    try {
      const response = await fetch("/api/workforce?manual=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RUN_CYCLE" }),
      });
      const body = await response.json().catch(() => ({})) as Payload & { error?: string };
      if (!response.ok) throw new Error(body.error || "cycle failed");
      setPayload((current) => ({ ...current, workforce: body.workforce }));
      setNotice("CYCLE COMPLETE");
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
    () => selected ? tasks.filter((task) => task.assignedTo === selected.id).slice(0, 8) : [],
    [selected, tasks],
  );
  const openTasks = tasks.filter((task) => ["QUEUED", "RUNNING", "BLOCKED", "FAILED", "WAITING_APPROVAL"].includes(task.status));
  const completed = tasks.filter((task) => task.status === "DONE").length;

  return (
    <main className={styles.page}>
      <div className={styles.grid} />
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.brandIcon}><Building2 size={19} /></div>
          <div>
            <strong>JARVIS // AI WORKFORCE</strong>
            <span>HIMIE JOHNSON VENTURES · AUTONOMOUS OPERATIONS FLOOR</span>
          </div>
        </div>
        <div className={styles.headerStats}>
          <Stat label="EMPLOYEES" value={String(agents.length || 9)} />
          <Stat label="OPEN WORK" value={String(openTasks.length)} />
          <Stat label="COMPLETE" value={String(completed)} />
          <Stat label="HEARTBEAT" value={workforce?.autonomy?.enabled ? (workforce.autonomy.cadenceMinutes + "M") : "OFF"} />
        </div>
        <Link href="/work" className={styles.coreLink}><BrainCircuit size={13} /> JARVIS CORE <ChevronRight size={12} /></Link>
      </header>

      <section className={styles.commandStrip}>
        <div>
          <span className={styles.liveDot} />
          <strong>{notice}</strong>
          <small>DURABLE WORKFLOW · HOURLY HEARTBEAT · DEEP RESEARCH THROTTLED TO ≤ 4H · EVENT/MANUAL RUNS AVAILABLE</small>
        </div>
        <div className={styles.commandActions}>
          <button onClick={toggleAlwaysOn} disabled={busy} className={payload?.workforce?.autonomy?.enabled ? styles.alwaysOn : ""}>
            <CircleDot size={11} /> {payload?.workforce?.autonomy?.enabled ? "24/7 ACTIVE" : "START 24/7"}
          </button>
          <button onClick={runCycle} disabled={busy}><Play size={12} /> {busy ? "WORKING" : "RUN ALL AGENTS"}</button>
        </div>
      </section>

      <section className={styles.floor}>
        <div className={styles.floorHead}>
          <div>
            <span>OPERATIONS FLOOR</span>
            <strong>HIMIE JOHNSON VENTURES // AI OFFICE</strong>
          </div>
          <small>SKY VIEW · FIXED WORKSTATIONS · STATE-DRIVEN ACTIVITY</small>
        </div>

        <div className={styles.worldShell}>
          <div className={styles.worldRibbon}>
            <span><i className={styles.dotWorking} /> ACTIVE AT DESK</span>
            <span><i className={styles.dotReady} /> READY / IDLE</span>
            <span><i className={styles.dotBlocked} /> BLOCKED / INCIDENT</span>
            <b>NO RANDOM ROAMING · MOVEMENT REPRESENTS REAL WORK</b>
          </div>

          <div className={styles.floorWorld}>
            <div className={styles.ceilingGlow} />
            <div className={styles.officeAisle + " " + styles.aisleHorizontal} />
            <div className={styles.officeAisle + " " + styles.aisleVertical} />

            <div className={styles.jarvisHub}>
              <div className={styles.jarvisHubCore}><BrainCircuit size={16} /></div>
              <div>
                <strong>JARVIS CORE</strong>
                <small>SUPERVISE · ROUTE · ESCALATE</small>
              </div>
            </div>

            <div className={styles.officeGrid}>
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
                const mode =
                  agent.status === "RUNNING" ? "WORKING" :
                  agent.status === "BLOCKED" ? "WAITING INPUT" :
                  agent.status === "ERROR" ? "INCIDENT" :
                  agent.status === "DONE" ? "READY TO REPORT" : "READY";

                return (
                  <button
                    type="button"
                    key={agent.id}
                    className={
                      styles.officeStation +
                      " " + styles[agent.status.toLowerCase()] +
                      (selectedId === agent.id ? " " + styles.selectedStation : "")
                    }
                    style={{
                      "--agent-accent": profile.accent,
                      "--station-index": index,
                    } as CSSProperties}
                    onClick={() => setSelectedId(agent.id)}
                  >
                    <div className={styles.stationZone}>
                      <span>{profile.zone}</span>
                      <b>{String(index + 1).padStart(2, "0")}</b>
                    </div>

                    <div className={styles.stationRoom}>
                      <div className={styles.roomWallBack} />
                      <div className={styles.roomWallSide} />
                      <div className={styles.stationLighting} />

                      <div className={styles.monitorArray}>
                        <div className={styles.monitorMain}>
                          <i /><i /><i /><i />
                          <small>{agent.status === "RUNNING" ? "LIVE WORK" : agent.status === "ERROR" ? "ALERT" : "STANDBY"}</small>
                        </div>
                        <div className={styles.monitorSide}>
                          <i /><i /><i />
                        </div>
                      </div>

                      <div className={styles.desk3d}>
                        <span className={styles.deskTop} />
                        <span className={styles.deskFront} />
                        <span className={styles.deskLegLeft} />
                        <span className={styles.deskLegRight} />
                        <span className={styles.keyboard} />
                      </div>

                      <div className={styles.worker3d}>
                        <span className={styles.workerHair} />
                        <span className={styles.workerHead3d}><i /></span>
                        <span className={styles.workerTorso3d} />
                        <span className={styles.workerArm3dLeft} />
                        <span className={styles.workerArm3dRight} />
                        <span className={styles.workerLeg3dLeft} />
                        <span className={styles.workerLeg3dRight} />
                        <span className={styles.workerChair} />
                        <span className={styles.workerShadow3d} />
                      </div>

                      <div className={styles.stationConsole}>
                        <Icon size={11} />
                        <span>{profile.station}</span>
                      </div>

                      {agent.status === "DONE" ? <div className={styles.reportPulse}>REPORT READY</div> : null}
                      {agent.status === "ERROR" || agent.status === "BLOCKED" ? <div className={styles.alertBeacon} /> : null}
                    </div>

                    <div className={styles.stationFooter}>
                      <div>
                        <strong>{profile.name}</strong>
                        <span>{profile.role}</span>
                      </div>
                      <div className={styles.stationState}>
                        <i />
                        <b>{mode}</b>
                      </div>
                    </div>
                    <small className={styles.stationTask}>{agent.currentWork || profile.specialty}</small>
                  </button>
                );
              })}
            </div>
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
            {(selectedTasks.length ? selectedTasks : tasks.slice(0, 8)).map((task) => (
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
