"use client";

import Link from "next/link";
import {
  Activity,
  BrainCircuit,
  BriefcaseBusiness,
  Building2,
  ChevronRight,
  CircleDot,
  Eye,
  Landmark,
  Network,
  Play,
  Search,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import styles from "./workforce-world.module.css";
import AgentsFloor from "./agents-floor";
import {
  AGENT_PROFILES,
  quickEvent,
  timeAgo,
  type WorkforceAgent,
  type WorkforceEvent,
  type WorkforceTask,
} from "./agent-profiles";

type Agent = WorkforceAgent;
type Task = WorkforceTask;
type RuntimeEvent = WorkforceEvent;

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
  truth?: {
    verified: number;
    observed: number;
    claimed: number;
    disputed: number;
    verificationRate: number;
    recent: Array<{
      taskId: string;
      title: string;
      state: "CLAIMED" | "OBSERVED" | "VERIFIED" | "DISPUTED";
      checkedBy: string | null;
      rationale: string;
      evidenceCount: number;
      updatedAt: string;
    }>;
  };
  worldState?: {
    asOf: string;
    mission: string;
    domains: Array<{
      domain: string;
      status: "HEALTHY" | "DEGRADED" | "BLOCKED" | "UNKNOWN";
      truth: "CLAIMED" | "OBSERVED" | "VERIFIED" | "DISPUTED";
      summary: string;
      source: string;
      asOf: string;
    }>;
  };
  decisionMemory?: Array<{
    id: string;
    at: string;
    decision: string;
    reason: string;
    expectedOutcome: string;
    evidence: string[];
  }>;
  scenarios?: Array<{
    id: string;
    title: string;
    trigger: string;
    impact: string;
    response: string;
    owner: string;
    status: "WATCH" | "ACTIVE" | "RESOLVED";
  }>;
  opportunities?: Array<{
    id: string;
    title: string;
    priority: "LOW" | "MEDIUM" | "HIGH";
    status: "WATCH" | "VALIDATE" | "READY" | "REJECTED";
    whyItMatters: string;
    evidence: string;
    nextAction: string;
    updatedAt: string;
  }>;
  metrics?: {
    verificationRate: number;
    autonomousCompletionRate: number;
    openLoops: number;
    staleOpenTasks: number;
    waitingOnDwight: number;
    closedLast24h: number;
    activeGaps: number;
    activeOpportunities: number;
  };
  capitalDesk?: {
    asOf: string;
    mode: "CONTROLLED_AGGRESSION";
    liquidity: number;
    personalDebt: number;
    currentStage: string;
    constraint: string;
    nextMove: string;
  };
  continuity?: {
    unattendedReady: boolean;
    blockingReasons: string[];
    last7Days: {
      closed: number;
      failed: number;
      verified: number;
      autonomous: number;
      escalations: number;
    };
    executiveExceptions: Array<{
      type: "APPROVAL" | "CRITICAL_GAP" | "FAILED_WORK" | "STALE_WORK";
      title: string;
      owner: string;
      reason: string;
    }>;
    whileAwayBrief: string;
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

const profiles = AGENT_PROFILES;

type OperatorIntent = "ACTIVE" | "PAUSED";

const WORKFORCE_INTENT_KEY = "jarvis-workforce-operator-intent-v1";

export default function WorkforceWorld() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [selectedId, setSelectedId] = useState("EXECUTIVE");
  const [busy, setBusy] = useState(false);
  const [taskText, setTaskText] = useState("");
  const [notice, setNotice] = useState("AUTONOMOUS FLOOR ONLINE");
  const [operatorIntent, setOperatorIntent] = useState<OperatorIntent | null>(null);
  const operatorIntentRef = useRef<OperatorIntent | null>(null);
  const repairingDurableRun = useRef(false);
  const payloadSignatureRef = useRef("");

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
      const signature = JSON.stringify(incoming);
      if (signature !== payloadSignatureRef.current) {
        payloadSignatureRef.current = signature;
        setPayload(incoming);
      }
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
      CANCELLED: 6,
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
  const truth = operatingSystem?.truth;
  const worldState = operatingSystem?.worldState;
  const metrics = operatingSystem?.metrics;
  const scenarios = operatingSystem?.scenarios ?? [];
  const opportunities = operatingSystem?.opportunities ?? [];
  const decisionMemory = operatingSystem?.decisionMemory ?? [];
  const capitalDesk = operatingSystem?.capitalDesk;
  const continuity = operatingSystem?.continuity;
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

      <AgentsFloor
        agents={agents}
        tasks={tasks}
        events={recentEvents}
        floorActive={floorActive}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />

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
                  <b>{task.verification?.state ?? "CLAIMED"}</b>
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
                    <label>LAST REPORTED RESULT · {timeAgo(selected.lastRanAt)}</label>
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

            <div className={styles.missionPanel}>
              <div className={styles.panelTitle}><ShieldCheck size={14} /><span>TRUTH LAYER</span><small>{truth?.verificationRate ?? 100}% VERIFIED</small></div>
              <div className={styles.doctrineFlow}>
                <div><b>V</b><span>VERIFIED · {truth?.verified ?? 0}</span></div>
                <div><b>O</b><span>OBSERVED · {truth?.observed ?? 0}</span></div>
                <div><b>C</b><span>CLAIMED · {truth?.claimed ?? 0}</span></div>
                <div><b>D</b><span>DISPUTED · {truth?.disputed ?? 0}</span></div>
              </div>
              <div className={styles.executionMode}>
                <span>OPERATING PROOF</span>
                <strong>{metrics?.openLoops ?? openTasks.length} OPEN LOOPS · {metrics?.closedLast24h ?? 0} CLOSED / 24H</strong>
                <p>AUTONOMOUS COMPLETION {metrics?.autonomousCompletionRate ?? 0}% · STALE OPEN WORK {metrics?.staleOpenTasks ?? 0}</p>
              </div>
            </div>

            <div className={styles.gapPanel}>
              <div className={styles.panelTitle}><Network size={14} /><span>CANONICAL WORLD STATE</span><small>{worldState?.domains.length ?? 0} DOMAINS</small></div>
              <div className={styles.gapList}>
                {(worldState?.domains ?? []).map((item) => (
                  <div className={styles.gapRow} key={item.domain}>
                    <i className={
                      styles[
                        item.status === "HEALTHY" ? "riskLOW" :
                        item.status === "DEGRADED" ? "riskHIGH" :
                        item.status === "BLOCKED" ? "riskCRITICAL" :
                        "riskMEDIUM"
                      ]
                    } />
                    <div>
                      <strong>{item.domain} · {item.status}</strong>
                      <span>{item.truth} · {quickEvent(item.summary)}</span>
                    </div>
                  </div>
                ))}
                {!worldState?.domains.length ? <div className={styles.empty}>WORLD STATE WILL POPULATE ON THE NEXT WORKFORCE CYCLE</div> : null}
              </div>
            </div>

            <div className={styles.boringPanel}>
              <div className={styles.panelTitle}><BrainCircuit size={14} /><span>STRATEGY ENGINE</span><small>SCENARIO + OFFENSE + MEMORY</small></div>
              <div className={styles.boringList}>
                {scenarios.slice(0, 2).map((scenario) => (
                  <div key={scenario.id}><CircleDot size={8} /><span>SCENARIO [{scenario.status}] · {scenario.title} — {quickEvent(scenario.response)}</span></div>
                ))}
                {opportunities.slice(0, 2).map((opportunity) => (
                  <div key={opportunity.id}><CircleDot size={8} /><span>OPPORTUNITY [{opportunity.priority}/{opportunity.status}] · {opportunity.title} — {quickEvent(opportunity.nextAction)}</span></div>
                ))}
                {decisionMemory.slice(0, 1).map((decision) => (
                  <div key={decision.id}><CircleDot size={8} /><span>DECISION MEMORY · {decision.decision} — {quickEvent(decision.reason)}</span></div>
                ))}
                {capitalDesk ? (
                  <div><CircleDot size={8} /><span>CAPITAL DESK · {capitalDesk.mode} · LIQUIDITY {capitalDesk.liquidity.toFixed(2)} · DEBT {capitalDesk.personalDebt.toFixed(2)} — {quickEvent(capitalDesk.nextMove)}</span></div>
                ) : null}
              </div>
            </div>

            <div className={styles.missionPanel}>
              <div className={styles.panelTitle}><BriefcaseBusiness size={14} /><span>OWNER ABSENCE</span><small>{continuity?.unattendedReady ? "UNATTENDED READY" : "EXCEPTIONS OPEN"}</small></div>
              <div className={styles.executionMode}>
                <span>7-DAY CONTINUITY</span>
                <strong>{continuity?.last7Days.closed ?? 0} CLOSED · {continuity?.last7Days.verified ?? 0} VERIFIED · {continuity?.last7Days.autonomous ?? 0} AUTONOMOUS</strong>
                <p>{continuity?.whileAwayBrief ?? "Continuity evidence will populate after the next workforce cycle."}</p>
              </div>
              <div className={styles.doctrineFlow}>
                {(continuity?.executiveExceptions ?? []).slice(0, 3).map((item, index) => (
                  <div key={item.type + item.title}><b>{String(index + 1).padStart(2, "0")}</b><span>{item.type} · {item.title}</span></div>
                ))}
                {continuity && !continuity.executiveExceptions.length ? <div><b>OK</b><span>NO EXECUTIVE EXCEPTIONS IN THE CURRENT OPERATING PICTURE</span></div> : null}
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
