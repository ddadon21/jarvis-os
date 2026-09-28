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
};

type WorkforcePayload = {
  ok?: boolean;
  workforce?: {
    status: string;
    lastCycleAt: string | null;
    executiveSummary: string;
    agents: Agent[];
    tasks?: Task[];
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
    () => tasks.filter((task) => ["QUEUED", "RUNNING", "BLOCKED", "FAILED", "WAITING_APPROVAL"].includes(task.status)).slice(0, 4),
    [tasks],
  );

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

      <div className="workforce-agent-grid">
        {agents.map((agent) => (
          <div className={`workforce-agent ${agent.status.toLowerCase()}`} key={agent.id} title={agent.currentWork}>
            <Bot size={11} />
            <div>
              <span>{agentLabels[agent.id] ?? agent.id}</span>
              <small>{agent.domain} · {agent.permissionCeiling}</small>
            </div>
            <strong>{agent.status}</strong>
          </div>
        ))}
      </div>

      <div className="workforce-queue">
        <div className="workforce-queue-head">
          <span>WORK QUEUE</span>
          <small>{data?.counts?.queuedTasks ?? 0} QUEUED · {data?.counts?.blockedTasks ?? 0} BLOCKED</small>
        </div>
        {openTasks.length ? openTasks.map((task) => (
          <div className="workforce-task" key={task.id}>
            <ShieldCheck size={10} />
            <div>
              <span>{task.title}</span>
              <small>{task.assignedTo} · {task.priority}</small>
            </div>
            <strong>{task.status}</strong>
          </div>
        )) : (
          <div className="workforce-empty">NO OPEN TASKS · AGENTS STANDING BY</div>
        )}
      </div>
    </div>
  );
}
