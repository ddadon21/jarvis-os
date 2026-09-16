"use client";

import { ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FinanceRuntimeState } from "../lib/jarvis-runtime";
import { FINANCE_SNAPSHOT, FINANCE_STAGES } from "../lib/finance-snapshot";

function money(value: number) {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function signedMoney(value: number) {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STAGE_COPY: Record<string, string> = {
  DEBT: "Eliminate personal revolving debt without draining the cash needed to operate.",
  STABILITY: "Stop depending on credit for normal life and keep every required bill current.",
  RESERVES: "Build a real cash floor and push adjusted net worth through the next $5K milestone.",
  CREDIT: "Drive utilization down, protect payment history, and rebuild borrowing strength.",
  CAPITAL: "Scale reliable income and keep more of every dollar available for productive use.",
  INVESTING: "Compound excess capital into productive assets instead of lifestyle drag.",
  ASSETS: "Own businesses and assets that produce cash flow while lifestyle upgrades stay affordable.",
};

function useFinanceRuntime() {
  const [state, setState] = useState<FinanceRuntimeState | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const response = await fetch("/api/finance/state", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { state?: FinanceRuntimeState };
        if (!cancelled && body.state) setState(body.state);
      } catch {}
    }
    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  return state;
}

export default function FinanceCockpitV2() {
  const runtime = useFinanceRuntime();
  const metrics = runtime?.metrics ?? {
    personalNetWorth: FINANCE_SNAPSHOT.personalNetWorth,
    providerNetWorth: FINANCE_SNAPSHOT.providerNetWorth,
    liquidity: FINANCE_SNAPSHOT.liquidity,
    investmentValue: FINANCE_SNAPSHOT.investmentValue,
    personalDebt: FINANCE_SNAPSHOT.personalDebt,
    authorizedUserBalance: FINANCE_SNAPSHOT.authorizedUserBalance,
  };
  const currentStage = runtime?.currentStage ?? FINANCE_SNAPSHOT.currentStage;
  const [selectedStage, setSelectedStage] = useState(currentStage);

  useEffect(() => setSelectedStage(currentStage), [currentStage]);

  const debts = useMemo(() => {
    if (!runtime) return [];
    const liabilityByKey = new Map(runtime.liabilities.map((item) => [item.accountKey, item]));
    return runtime.accounts
      .filter((account) => account.type === "credit" || account.type === "loan")
      .map((account) => ({ account, liability: liabilityByKey.get(account.key) }));
  }, [runtime]);

  const milestone = useMemo(() => {
    const step = metrics.personalNetWorth < 100_000 ? 5_000 : 10_000;
    const floor = Math.floor(Math.max(0, metrics.personalNetWorth) / step) * step;
    const target = floor + step;
    const progress = metrics.personalNetWorth <= floor ? 0 : Math.min(100, ((metrics.personalNetWorth - floor) / step) * 100);
    return { step, target, progress };
  }, [metrics.personalNetWorth]);

  const directive = metrics.personalDebt > 0
    ? `Clear ${money(metrics.personalDebt)} of personal revolving debt while protecting operating cash.`
    : `Advance adjusted net worth toward ${money(milestone.target)} and keep strengthening cash, credit and productive assets.`;

  const syncLabel = runtime?.mode === "DIRECT" ? "DIRECT · AUTO" : "REAL SNAPSHOT";

  return (
    <section className="finance-cockpit finance-operating-system">
      <div className="finance-titlebar">
        <div><span>FINANCE</span><strong>CAPITAL PATH</strong></div>
        <div className="finance-sync"><i /> {syncLabel}</div>
      </div>

      <div className="finance-metrics">
        <Metric label="NET WORTH" value={signedMoney(metrics.personalNetWorth)} note="Authorized-user debt excluded." />
        <Metric label="CASH" value={money(metrics.liquidity)} note="Connected depository cash." />
        <Metric label="PERSONAL DEBT" value={money(metrics.personalDebt)} note={`${money(metrics.authorizedUserBalance)} AU tracked separately.`} />
        <Metric label="ULTIMATE TARGET" value="$100M CASH" note="Long-term capital destination." />
      </div>

      <div className="finance-section-head">
        <div><span>THE PATH</span><strong>DEBT → STABILITY → RESERVES → CREDIT → CAPITAL → INVESTING → ASSETS</strong></div>
        <small>{currentStage} NOW</small>
      </div>

      <div className="finance-stage-row">
        {FINANCE_STAGES.map((stage) => (
          <div key={stage} role="button" tabIndex={0} onClick={() => setSelectedStage(stage)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedStage(stage); }} className={stage === selectedStage ? "active" : ""}>
            <span>{stage}</span>
          </div>
        ))}
      </div>

      <div className="finance-explainer">
        <span>{selectedStage === currentStage ? "JARVIS // NOW" : selectedStage}</span>
        <strong>{selectedStage === currentStage ? directive : STAGE_COPY[selectedStage]}</strong>
        <p>{selectedStage === currentStage ? `Next wealth milestone: ${money(milestone.target)} · ${milestone.progress.toFixed(1)}%.` : STAGE_COPY[selectedStage]}</p>
      </div>

      <div className="finance-section-head"><div><span>CREDIT + DEBT</span><strong>WHAT JARVIS IS WATCHING</strong></div><small>{debts.length || 3} CARDS</small></div>
      <div className="finance-debt-grid">
        {debts.length > 0 ? debts.map(({ account, liability }) => {
          const utilization = account.limit ? Math.min(999, (account.current / account.limit) * 100) : null;
          return (
            <article className={`finance-debt-card ${account.ownership === "AUTHORIZED_USER" ? "au" : ""}`} key={account.key}>
              <div><span>{account.name}</span><b>{account.ownership}</b></div>
              <strong>{money(account.current)}</strong>
              <p>{liability?.apr == null ? "APR unavailable" : `${liability.apr.toFixed(1)}% APR`} · {liability?.minimum == null ? "minimum unavailable" : `${money(liability.minimum)} minimum`}</p>
              <small>{utilization == null ? "Utilization unavailable" : `${utilization.toFixed(1)}% utilization`}</small>
            </article>
          );
        }) : (
          <article className="finance-debt-card"><div><span>PERSONAL REVOLVING DEBT</span><b>REAL SNAPSHOT</b></div><strong>{money(metrics.personalDebt)}</strong><p>Direct refresh will replace snapshot values automatically once the provider connection is live.</p></article>
        )}
      </div>

      <div className="finance-roadmap">
        <ShieldCheck size={15} />
        <div><span>OPERATING RULE</span><strong>WATCH MONEY → PROTECT CASH → CLEAR DRAG → BUILD CREDIT → GROW CAPITAL → BUY ASSETS → UPGRADE LIFE</strong></div>
      </div>
    </section>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="finance-metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}
