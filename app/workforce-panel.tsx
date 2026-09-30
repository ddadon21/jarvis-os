"use client";

import Link from "next/link";

import { Bot, Play, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Agent = {
  id: string;
  domain: string;
  status: "IDLE" | "RUNNING" | "DONE" | "BLOCKED" | "ERROR";
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
  blockedReason: string | null;
  evidence?: string[];
  governance?: {
    action: "AUTO_PROCEED" | "USER_AUTHORIZED" | "WAIT_FOR_DWIGHT" | "BLOCKED";
    scope: "MAINTAIN" | "EXECUTE" | "EXPAND";
    risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    reason: string;
  };
};

type WorkforcePayload = {
  ok?: boolean;
  workforce?: {
    status: string;
    lastCycleAt: string | null;
    executiveSummary: string;
    agents: Agent[];
    tasks?: Task[];
    autonomy?: {
      enabled: boolean;
      cadenceMinutes: number;
    };
  };
  counts?: {
    agents: number;
    activeObjectives: number;
    queuedTasks: number;
    runningTasks: number;
    blockedTasks: number;
  };
};

const agentLabels: Record<string, string> = {
  EXECUTIVE: "EXECUTIVE",
  FINANCE_CFO: "CFO",
  SENTRYOPS_RESEARCH: "SENTRYOPS RESEARCH",
  TRADING_OBSERVER: "TRADING OBSERVER",
  BUILDER: "BUILDER",
  JARVIS_QA: "QA WATCHDOG",
  IT_INFRA: "IT INFRA",
  IT_SECURITY: "IT SECURITY",
  IT_INTEGRATIONS: "IT INTEGRATIONS",
};

export default function WorkforcePanel() {
  const [data, setData] = useState<WorkforcePayload | null>(null);
  const [running, setRunning] = useState(false);
  const [detail, setDetail] = useState("Loading workforce...");

  async function refresh() {
    try {
      const response = await fetch("/api/workforce", { cache: "no-store" });
      if (!response.ok) throw new Error("Workforce unavailable");
      const payload = (await response.json()) as WorkforcePayload;
      setData(payload);
      setDetail(payload.workforce?.lastCycleAt ? "Workforce online" : "Ready for first cycle");
    } catch {
      setDetail("Workforce link unavailable");
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  async function runCycle() {
    if (running) return;
    setRunning(true);
    setDetail("Agents working...");
    try {
      const response = await fetch("/api/workforce?manual=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RUN_CYCLE" }),
      });
      const payload = (await response.json().catch(() => ({}))) as WorkforcePayload & { error?: string };
      if (!response.ok) {
        setDetail(payload.error === "Unauthorized" ? "Manual runs require workforce authorization on production" : payload.error || "Cycle failed");
        return;
      }
      setData((current) => ({ ...current, workforce: payload.workforce }));
      setDetail("Cycle complete");
      window.dispatchEvent(new CustomEvent("jarvis-obsidian-sync-now"));
      await refresh();
    } catch {
      setDetail("Cycle failed");
    } finally {
      setRunning(false);
    }
  }

  const agents = data?.workforce?.agents ?? [];
  const tasks = data?.workforce?.tasks ?? [];
  const openTasks = useMemo(
    () => tasks
      .filter((task) => ["QUEUED", "RUNNING", "BLOCKED", "WAITING_APPROVAL"].includes(task.status))
      .sort((a, b) => {
        const rank: Record<Task["status"], number> = {
          RUNNING: 0,
          QUEUED: 1,
          BLOCKED: 2,
          WAITING_APPROVAL: 3,
          DONE: 4,
          FAILED: 5,
        };
        return rank[a.status] - rank[b.status] || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      })
      .slice(0, 5),
    [tasks],
  );
  const completedTasks = useMemo(
    () => tasks
      .filter((task) => task.status === "DONE")
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, 4),
    [tasks],
  );

  function ago(value: string) {
    const ms = Math.max(0, Date.now() - Date.parse(value));
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 1) return "NOW";
    if (minutes < 60) return minutes + "M";
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + "H";
    return Math.floor(hours / 24) + "D";
  }

  return (
    <div className="workforce-panel">
      <div className="workforce-toolbar">
        <div>
          <span>AI EMPLOYEES</span>
          <strong>{agents.length || 6} ONLINE ROSTER</strong>
          <small>{detail}</small>
        </div>
        <div className="workforce-toolbar-actions">
          <Link href="/workforce">OPEN FLOOR</Link>
          <button type="button" onClick={runCycle} disabled={running}>
            <Play size={11} /> {running ? "WORKING" : "RUN CYCLE"}
          </button>
        </div>
      </div>

      <div className="workforce-state-line">
        <span>{data?.workforce?.autonomy?.enabled ? "24/7 ACTIVE" : "MANUAL / PAUSED"}</span>
        <b>{agents.length || 9} AGENTS</b>
        <small>{data?.workforce?.autonomy?.enabled ? `${data.workforce.autonomy.cadenceMinutes ?? 15}M CYCLE` : "OPEN FLOOR FOR FULL DETAIL"}</small>
      </div>

      <div className="workforce-live-section">
        <div className="workforce-queue-head">
          <span>WORKING NOW</span>
          <small>{openTasks.length} ACTIVE / NEXT</small>
        </div>
        {openTasks.length ? openTasks.map((task) => (
          <div className="workforce-task live" key={task.id}>
            <span className="workforce-task-dot" />
            <div>
              <strong>{agentLabels[task.assignedTo] ?? task.assignedTo}</strong>
              <span>{task.title}</span>
              {task.governance?.action === "WAIT_FOR_DWIGHT" ? <small>WAITING ON DWIGHT · {task.governance.reason}</small> : null}
            </div>
            <b>{task.status}</b>
          </div>
        )) : (
          <div className="workforce-empty">NO OPEN OUTCOMES · TEAM MONITORING CURRENT MISSIONS</div>
        )}
      </div>

      <div className="workforce-done-section">
        <div className="workforce-queue-head">
          <span>RECENTLY DONE</span>
          <small>{completedTasks.length} SHOWN</small>
        </div>
        {completedTasks.length ? completedTasks.map((task) => (
          <div className="workforce-task done" key={task.id}>
            <ShieldCheck size={10} />
            <div>
              <strong>{task.title}</strong>
              <span>{agentLabels[task.assignedTo] ?? task.assignedTo} · {ago(task.updatedAt)} AGO</span>
              {task.result ? <small>{task.result.length > 96 ? task.result.slice(0, 93) + "…" : task.result}</small> : null}
            </div>
            <b>DONE</b>
          </div>
        )) : (
          <div className="workforce-empty">NO COMPLETED OUTCOMES RECORDED YET</div>
        )}
      </div>
    </div>
  );
}
