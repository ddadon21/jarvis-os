"use client";

import Link from "next/link";
import {
  BrainCircuit,
  Building2,
  ChevronRight,
  CircleDot,
  Play,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import styles from "./workforce-world.module.css";
import ops from "./workforce-ops.module.css";
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
  const [reasons, setReasons] = useState<Record<string, string>>({});
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

  async function postAction(body: Record<string, unknown>, working: string, done: string) {
    if (busy) return;
    setBusy(true);
    setNotice(working);
    try {
      const response = await fetch("/api/workforce?manual=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; task?: Task };
      if (!response.ok) throw new Error(result.error || "action failed");
      setNotice(result.task?.status === "FAILED" ? "TASK FAILED · " + (result.task.result ?? "").toUpperCase().slice(0, 120) : done);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message.toUpperCase() : "ACTION FAILED");
    } finally {
      setBusy(false);
    }
  }

  const decide = (task: Task, decision: "APPROVED" | "DENIED") =>
    postAction({ action: "DECIDE", taskId: task.id, decision, reason: reasons[task.id] ?? null },
      decision === "APPROVED" ? "APPROVING" : "DENYING",
      decision === "APPROVED" ? "APPROVED · QUEUED FOR THE NEXT RUN" : "DENIED");
  const runNow = (task: Task) => postAction({ action: "RUN_TASK", taskId: task.id }, "RUNNING " + task.assignedTo + " NOW", "TASK RUN COMPLETE");

  const workforce = payload?.workforce;
  const agents = workforce?.agents ?? [];
  const objectives = workforce?.objectives ?? [];
  const tasks = workforce?.tasks ?? [];
  const operatingSystem = workforce?.operatingSystem;
  const gaps = (operatingSystem?.gaps ?? []).filter((gap) => gap.status !== "RESOLVED").slice(0, 8);
  const doctrine = operatingSystem?.doctrine ?? [];
  const governance = operatingSystem?.governance;
  const recentEvents = payload?.recentEvents ?? [];
  const byNewest = (a: Task, b: Task) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  const waiting = tasks.filter((task) => task.status === "WAITING_APPROVAL").sort(byNewest);
  const active = tasks.filter((task) => ["RUNNING", "QUEUED", "BLOCKED"].includes(task.status) && task.source !== "workforce.cycle").sort(byNewest);
  const finished = tasks.filter((task) => ["DONE", "FAILED", "CANCELLED"].includes(task.status) && task.source !== "workforce.cycle").sort(byNewest).slice(0, 10);
  const checks = tasks.filter((task) => task.source === "workforce.cycle" && ["DONE", "FAILED", "BLOCKED"].includes(task.status)).sort(byNewest).slice(0, 9);
  const openCount = tasks.filter((task) => ["QUEUED", "RUNNING", "BLOCKED", "WAITING_APPROVAL"].includes(task.status)).length;
  const completedCount = tasks.filter((task) => task.status === "DONE").length;
  const serverFloorActive = Boolean(workforce?.autonomy?.enabled);
  const floorActive = operatorIntent === "ACTIVE" || (
    operatorIntent === null && serverFloorActive
  );
  const canRun = (task: Task) => (task.status === "QUEUED" || task.status === "FAILED") &&
    (task.governance?.action === "AUTO_PROCEED" || task.governance?.action === "USER_AUTHORIZED");
  const agentName = (id: string) => profiles[id]?.name ?? id;

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
          <Stat label="WAITING ON YOU" value={String(waiting.length)} />
          <Stat label="OPEN WORK" value={String(openCount)} />
          <Stat label="COMPLETE" value={String(completedCount)} />
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

      <section className={ops.approvals} aria-label="Waiting on Dwight">
        <div className={ops.sectionHead}>
          <div><span>DECISIONS</span><strong>WAITING ON YOU</strong></div>
          <small>{waiting.length ? waiting.length + " NEED A DECISION" : "NOTHING WAITING"}</small>
        </div>
        {waiting.length ? (
          <div className={ops.approvalList}>
            {waiting.map((task) => (
              <div key={task.id} className={ops.approval}>
                <div className={ops.approvalBody}>
                  <b>{agentName(task.assignedTo)} · {task.priority}</b>
                  <strong>{task.title}</strong>
                  <small>{task.governance?.reason ?? task.blockedReason ?? "Approval required."}</small>
                  <input
                    value={reasons[task.id] ?? ""}
                    onChange={(event) => setReasons((current) => ({ ...current, [task.id]: event.target.value }))}
                    placeholder="Optional note to the agent"
                    aria-label={"Note for " + task.title}
                  />
                </div>
                <div className={ops.approvalActions}>
                  <button type="button" className={ops.approve} disabled={busy} onClick={() => decide(task, "APPROVED")}>APPROVE</button>
                  <button type="button" className={ops.deny} disabled={busy} onClick={() => decide(task, "DENIED")}>DENY</button>
                </div>
              </div>
            ))}
          </div>
        ) : <p className={ops.empty}>No task needs your approval. Expansions, external actions and redesigns will appear here before any agent acts on them.</p>}
      </section>

      <section className={ops.workGrid}>
        <div className={ops.panel}>
          <div className={ops.sectionHead}>
            <div><span>ASSIGN</span><strong>GIVE AN AGENT WORK</strong></div>
            <small>RUNS ON THE NEXT CYCLE OR NOW</small>
          </div>
          <form className={ops.assign} onSubmit={assignTask}>
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} aria-label="Agent">
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agentName(agent.id)} · {profiles[agent.id]?.role ?? agent.domain}</option>)}
            </select>
            <input value={taskText} onChange={(event) => setTaskText(event.target.value)} placeholder={"What should " + agentName(selectedId) + " do?"} aria-label="Task" />
            <button disabled={busy || !taskText.trim()}>ASSIGN</button>
          </form>
          <div className={ops.sectionHead}>
            <div><span>IN PROGRESS</span><strong>QUEUED + RUNNING</strong></div>
            <small>{active.length}</small>
          </div>
          <div className={ops.list}>
            {active.map((task) => (
              <TaskRow key={task.id} task={task} name={agentName(task.assignedTo)}>
                {canRun(task) ? <button type="button" disabled={busy} onClick={() => runNow(task)}>RUN NOW</button> : null}
              </TaskRow>
            ))}
            {!active.length ? <p className={ops.empty}>No assigned work in progress.</p> : null}
          </div>
        </div>

        <div className={ops.panel}>
          <div className={ops.sectionHead}>
            <div><span>OUTCOMES</span><strong>FINISHED WORK</strong></div>
            <small className={ops.legend}><i className={ops.proofVERIFIED} /> MEASURED <i className={ops.proofOBSERVED} /> TOOL-GROUNDED <i className={ops.proofCLAIMED} /> NO EVIDENCE</small>
          </div>
          <div className={ops.list}>
            {finished.map((task) => (
              <TaskRow key={task.id} task={task} name={agentName(task.assignedTo)} showResult>
                {canRun(task) ? <button type="button" disabled={busy} onClick={() => runNow(task)}>RETRY</button> : null}
              </TaskRow>
            ))}
            {!finished.length ? <p className={ops.empty}>No assigned work has finished yet.</p> : null}
          </div>
          <div className={ops.sectionHead}>
            <div><span>EVERY CYCLE</span><strong>STANDING CHECKS</strong></div>
            <small>{workforce?.lastCycleAt ? "LAST " + timeAgo(workforce.lastCycleAt) : "NOT RUN YET"}</small>
          </div>
          <div className={ops.checks}>
            {checks.map((task) => (
              <div key={task.id} className={ops.check + " " + (task.status === "DONE" ? ops.checkOk : ops.checkBad)} title={task.result ?? ""}>
                <b>{agentName(task.assignedTo)}</b>
                <span>{quickEvent(task.result ?? task.blockedReason ?? task.title)}</span>
              </div>
            ))}
          </div>
        </div>

        <aside className={ops.panel}>
          <div className={ops.sectionHead}>
            <div><span>CHIEF OF STAFF</span><strong>BRIEF</strong></div>
            <small>{workforce?.status ?? "STARTING"}</small>
          </div>
          <p className={ops.brief}>{operatingSystem?.chiefOfStaff.highestLeverage ?? "Run the first workforce cycle."}</p>
          <p className={ops.subtle}>{workforce?.executiveSummary ?? "JARVIS is preparing the operating picture."}</p>
          <div className={ops.sectionHead}>
            <div><span>MISSIONS</span><strong>ACTIVE OBJECTIVES</strong></div>
            <small>{objectives.filter((item) => item.status === "ACTIVE").length}</small>
          </div>
          {objectives.filter((item) => item.status === "ACTIVE").slice(0, 4).map((objective) => (
            <div key={objective.id} className={ops.objective}>
              <strong>{objective.title}</strong>
              <span>{objective.currentFocus}</span>
            </div>
          ))}
          <div className={ops.sectionHead}>
            <div><span>EVENTS</span><strong>LATEST</strong></div>
            <small><Link href="/learning">LEARNING LAB →</Link></small>
          </div>
          <div className={ops.events}>
            {recentEvents.slice(0, 8).map((event) => (
              <div key={event.id}><b>{timeAgo(event.occurredAt)}</b><span>{quickEvent(event.summary)}</span></div>
            ))}
          </div>
        </aside>
      </section>

      <details className={ops.drawer}>
        <summary>RULES, CHARTER AND OPEN GAPS</summary>
        <div className={ops.drawerGrid}>
          <div>
            <h3>Operating doctrine</h3>
            <ol>{doctrine.map((line) => <li key={line}>{line}</li>)}</ol>
          </div>
          <div>
            <h3>Agents may proceed with</h3>
            <ul>{(governance?.autoProceed ?? []).map((line) => <li key={line}>{line}</li>)}</ul>
            <h3>Ask Dwight first</h3>
            <ul>{(governance?.askDwightFirst ?? []).map((line) => <li key={line}>{line}</li>)}</ul>
            <h3>Hard limits</h3>
            <ul>{(governance?.neverWithoutExplicitUnlock ?? []).map((line) => <li key={line}>{line}</li>)}</ul>
          </div>
          <div>
            <h3>Open gaps</h3>
            <ul>{gaps.map((gap) => <li key={gap.id}>[{gap.risk}] {gap.title}</li>)}</ul>
            {!gaps.length ? <p className={ops.empty}>No open gaps.</p> : null}
          </div>
        </div>
      </details>
    </main>
  );
}

function TaskRow({ task, name, showResult, children }: { task: Task; name: string; showResult?: boolean; children?: React.ReactNode }) {
  const proof = task.verification?.state;
  return (
    <div className={ops.task}>
      <i className={ops["status" + task.status]} />
      <div>
        <strong>{task.title}</strong>
        <span>{name} · {task.status.replace(/_/g, " ")} · {timeAgo(task.updatedAt)}{task.governance?.action === "USER_AUTHORIZED" ? " · YOUR REQUEST" : ""}</span>
        {showResult && (task.result || task.blockedReason) ? <small>{task.result ?? task.blockedReason}</small> : null}
        {!showResult && task.blockedReason ? <small>{task.blockedReason}</small> : null}
      </div>
      <div className={ops.taskSide}>
        {proof && task.status === "DONE" ? <b className={ops["proof" + proof]}>{proof === "VERIFIED" ? "MEASURED" : proof === "OBSERVED" ? "GROUNDED" : proof}</b> : null}
        {children}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className={styles.stat}><span>{label}</span><strong>{value}</strong></div>;
}
