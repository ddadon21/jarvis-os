"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import type { FinanceRuntimeState } from "../lib/jarvis-runtime";
import { FINANCE_GOALS } from "../lib/finance-snapshot";
import FinanceCockpitV2 from "./finance-cockpit-v2";

// Both Jarvis shells use the same Finance workspace and source of truth.
export default function FinanceCockpit(_: { onAsk?: (prompt: string) => void }) {
  return <FinanceCockpitV2 />;
}
export function FinanceGoalMiniList() {
  const [runtime, setRuntime] = useState<FinanceRuntimeState | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch("/api/finance/state", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const body = await response.json();
        if (!controller.signal.aborted && body.state?.goals) setRuntime(body.state);
      } catch { /* Keep the dated imported goals if refresh is unavailable. */ }
    }
    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);
  const goals = runtime?.goals ?? FINANCE_GOALS;
  return <div className="finance-mini-goals">{goals.slice(0, 4).map(goal => <div key={goal.name}>
    <div><span>{goal.name}</span><b>{goal.progress == null ? goal.state : `${Math.round(goal.progress)}%`}</b></div>
    {goal.progress != null ? <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, goal.progress))}%` }} /></div> : <small>{goal.current}</small>}
  </div>)}<div className="finance-mini-proof"><CheckCircle2 size={12} />ONE FOCUS · IMPORTED ACCOUNT DATA</div></div>;
}
