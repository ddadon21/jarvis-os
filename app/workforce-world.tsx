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
import { FormEvent, useEffect, useMemo, useState } from "react";
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
}> = {
  EXECUTIVE: {
    name: "EXECUTIVE",
    role: "Chief of Staff",
    station: "Command Center",
    icon: BrainCircuit,
    specialty: "Priorities · delegation · approvals",
  },
  FINANCE_CFO: {
    name: "CFO",
    role: "Capital Intelligence",
    station: "Capital Desk",
    icon: Landmark,
    specialty: "Cash · debt · leverage · capital",
  },
  SENTRYOPS_RESEARCH: {
    name: "RESEARCH",
    role: "SentryOps Intelligence",
    station: "Research Lab",
    icon: Search,
    specialty: "Markets · agencies · competitors",
  },
  TRADING_OBSERVER: {
    name: "OBSERVER",
    role: "Trading Intelligence",
    station: "Observation Bay",
    icon: Eye,
    specialty: "Setups · execution · behavior",
  },
  BUILDER: {
    name: "BUILDER",
    role: "Software Engineer",
    station: "Build Lab",
    icon: Code2,
    specialty: "JARVIS · SentryOps · automation",
  },
  JARVIS_QA: {
    name: "QA",
    role: "Quality Watchdog",
    station: "QA Control",
    icon: ShieldCheck,
    specialty: "Failures · evidence · reliability",
  },
  IT_INFRA: {
    name: "INFRA",
    role: "Infrastructure / SRE",
    station: "Network Operations",
    icon: ServerCog,
    specialty: "Runtime · uptime · persistence",
  },
  IT_SECURITY: {
    name: "SECURITY",
    role: "Security Operations",
    station: "Security Operations Center",
    icon: ShieldCheck,
    specialty: "Access · secrets · boundaries",
  },
  IT_INTEGRATIONS: {
    name: "INTEGRATIONS",
    role: "Systems Integration",
    station: "Integration Hub",
    icon: Network,
    specialty: "APIs · connectors · handoffs",
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
          <Stat label="HEARTBEAT" value="1H" />
        </div>
        <Link href="/work" className={styles.coreLink}><BrainCircuit size={13} /> JARVIS CORE <ChevronRight size={12} /></Link>
      </header>

      <section className={styles.commandStrip}>
        <div>
          <span className={styles.liveDot} />
          <strong>{notice}</strong>
          <small>24/7 HOURLY HEARTBEAT · DEEP RESEARCH THROTTLED TO ≤ 4H · EVENT/MANUAL RUNS AVAILABLE</small>
        </div>
        <button onClick={runCycle} disabled={busy}><Play size={12} /> {busy ? "WORKING" : "RUN ALL AGENTS"}</button>
      </section>

      <section className={styles.floor}>
        <div className={styles.floorHead}>
          <div>
            <span>OPERATIONS FLOOR</span>
            <strong>LIVE EMPLOYEE STATIONS</strong>
          </div>
          <small>Characters animate according to real agent state.</small>
        </div>

        <div className={styles.stationGrid}>
          {agents.map((agent) => {
            const profile = profiles[agent.id] ?? {
              name: agent.id,
              role: agent.domain,
              station: "Operations",
              icon: Bot,
              specialty: agent.currentWork,
            };
            const Icon = profile.icon;
            return (
              <button
                type="button"
                key={agent.id}
                className={styles.station + " " + styles[agent.status.toLowerCase()] + (selectedId === agent.id ? " " + styles.selected : "")}
                onClick={() => setSelectedId(agent.id)}
              >
                <div className={styles.stationTop}>
                  <div><Icon size={12} /><span>{profile.station}</span></div>
                  <strong>{agent.status}</strong>
                </div>

                <div className={styles.scene}>
                  <div className={styles.screen}>
                    <i /><i /><i />
                    <span>{agent.status === "RUNNING" ? "PROCESSING" : agent.status === "ERROR" ? "ALERT" : agent.status === "BLOCKED" ? "WAITING" : "READY"}</span>
                  </div>
                  <div className={styles.operator}>
                    <span className={styles.head}><i /></span>
                    <span className={styles.body} />
                    <span className={styles.armLeft} />
                    <span className={styles.armRight} />
                    <span className={styles.legLeft} />
                    <span className={styles.legRight} />
                  </div>
                  <div className={styles.desk}><span /></div>
                  <div className={styles.floorSignal} />
                </div>

                <div className={styles.stationCopy}>
                  <strong>{profile.name}</strong>
                  <span>{profile.role}</span>
                  <small>{profile.specialty}</small>
                </div>
              </button>
            );
          })}
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
