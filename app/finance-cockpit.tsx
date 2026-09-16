"use client";

import { CheckCircle2, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FinanceRuntimeState } from "../lib/jarvis-runtime";
import {
  FINANCE_ACCOUNT_PURPOSES,
  FINANCE_DEBTS,
  FINANCE_GOALS,
  FINANCE_SNAPSHOT,
  FINANCE_STAGES,
} from "../lib/finance-snapshot";

function money(value: number) {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function signedMoney(value: number) {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function goalClass(state: string) {
  if (state === "GREEN") return "finance-goal-good";
  if (state === "YELLOW") return "finance-goal-watch";
  if (state === "SETUP") return "finance-goal-setup";
  return "finance-goal-risk";
}

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
      } catch {
        // Keep the last known snapshot visible if the runtime endpoint is temporarily unavailable.
      }
    }

    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return state;
}

export default function FinanceCockpit(_: { onAsk?: (prompt: string) => void }) {
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
  const nextStage = runtime?.nextStage ?? FINANCE_SNAPSHOT.nextStage;
  const goals = runtime?.goals ?? FINANCE_GOALS;

  const debts = useMemo(() => {
    if (!runtime) return FINANCE_DEBTS.map((debt) => ({ ...debt, key: debt.name }));
    const liabilityByKey = new Map(runtime.liabilities.map((liability) => [liability.accountKey, liability]));
    return runtime.accounts
      .filter((account) => account.type === "credit" || account.type === "loan")
      .map((account) => {
        const liability = liabilityByKey.get(account.key);
        return {
          key: account.key,
          name: account.name,
          balance: account.current,
          apr: liability?.apr ?? null,
          minimum: liability?.minimum ?? null,
          due: liability?.due ?? null,
          ownership: account.ownership,
          limit: account.limit,
        };
      });
  }, [runtime]);

  const accountGroups = useMemo(() => {
    if (!runtime) return FINANCE_ACCOUNT_PURPOSES.map((account) => ({ ...account }));
    const groups = new Map<string, { institution: string; role: string; detail: string }>();
    for (const account of runtime.accounts) {
      const key = `${account.institution}|${account.role}`;
      const signed = account.type === "credit" || account.type === "loan" ? -Math.max(0, account.current) : account.current;
      const existing = groups.get(key);
      if (existing) {
        const match = existing.detail.match(/^([+-]?\$[\d,.]+)/);
        const prior = match ? Number(match[1].replace(/[$,]/g, "")) : 0;
        existing.detail = `${signedMoney(prior + signed)} · ${account.role.toLowerCase()}`;
      } else {
        groups.set(key, {
          institution: account.institution,
          role: account.role,
          detail: `${signedMoney(signed)} · ${account.role.toLowerCase()}`,
        });
      }
    }
    return [...groups.values()];
  }, [runtime]);

  const syncLabel = runtime?.mode === "DIRECT"
    ? runtime.source.includes("REALTIME") ? "DIRECT · REALTIME" : "DIRECT · AUTO"
    : "REAL SNAPSHOT";

  const directive = metrics.personalDebt > 0
    ? `Clear ${money(metrics.personalDebt)} of personal revolving debt while protecting enough cash to keep operating without creating new debt.`
    : metrics.liquidity < 10_000
      ? `Debt is controlled. Build liquid reserves from ${money(metrics.liquidity)} toward $10,000.`
      : "Protect liquidity and route excess capital toward the next net-worth milestone and long-term assets.";

  return (
    <section className="finance-cockpit finance-operating-system">
      <div className="finance-titlebar">
        <div>
          <span>HIMIE JOHNSON VENTURES // DWIGHT</span>
          <strong>FINANCE // THE PATH</strong>
        </div>
        <div className="finance-sync"><i /> {syncLabel}</div>
      </div>

      <div className="finance-metrics">
        <Metric label="ADJUSTED NET WORTH" value={signedMoney(metrics.personalNetWorth)} note="Authorized-user debt is excluded from Dwight's working liability total." emphasis />
        <Metric label="LIQUIDITY" value={money(metrics.liquidity)} note="Connected depository cash in the current Finance state." />
        <Metric label="PERSONAL DEBT" value={money(metrics.personalDebt)} note={`${money(metrics.authorizedUserBalance)} authorized-user balance tracked separately.`} />
        <Metric label="CURRENT STAGE" value={currentStage} note={`Next stage: ${nextStage}.`} />
      </div>

      <div className="finance-section-head">
        <div>
          <span>THE FINANCIAL PATH</span>
          <strong>DEBT → STABILITY → RESERVES → CREDIT → CAPITAL → INVESTING → ASSETS</strong>
        </div>
        <small>ONE STAGE AT A TIME</small>
      </div>

      <div className="finance-stage-row">
        {FINANCE_STAGES.map((stage) => (
          <div key={stage} className={stage === currentStage ? "active" : ""}>
            <span>{stage}</span>
          </div>
        ))}
      </div>

      <div className="finance-explainer">
        <span>JARVIS DIRECTIVE // NOW</span>
        <strong>{directive}</strong>
        <p>
          Jarvis recalculates this path from the Finance runtime state. When the direct provider is connected, balance changes will flow into this screen without rebuilding the site.
        </p>
      </div>

      <div className="finance-operating-grid">
        <article className="finance-action-card priority">
          <span>NOW // {currentStage}</span>
          <strong>{directive}</strong>
          <p>Every new dollar is judged against the active stage before lifestyle expansion or lower-priority capital uses.</p>
        </article>
        <article className="finance-action-card">
          <span>AFTER // STABILITY + RESERVES</span>
          <strong>Build a real cash floor after debt is controlled.</strong>
          <p>The goal is to stop depending on credit for normal life and create enough runway that one bad month does not reset progress.</p>
        </article>
        <article className="finance-action-card">
          <span>THEN // CREDIT + CAPITAL</span>
          <strong>Strengthen credit while cash begins to accumulate.</strong>
          <p>Utilization falls, payment history stays clean, liquidity rises, and larger financial decisions become easier to evaluate.</p>
        </article>
        <article className="finance-action-card">
          <span>DESTINATION // INVESTING + ASSETS</span>
          <strong>Turn excess cash flow into ownership and compounding.</strong>
          <p>$10K liquid, rolling net-worth milestones, $1M net worth, moving out, and the Supra become consequences of stronger finances—not distractions from them.</p>
        </article>
      </div>

      <div className="finance-section-head">
        <div><span>DEBT POSITION</span><strong>WHAT MUST BE CLEARED</strong></div>
        <small>{money(metrics.personalDebt)} PERSONAL</small>
      </div>

      <div className="finance-debt-grid">
        {debts.map((debt) => {
          const utilization = debt.limit ? Math.min(999, (debt.balance / debt.limit) * 100) : null;
          return (
            <article className={`finance-debt-card ${debt.ownership === "AUTHORIZED_USER" ? "au" : ""}`} key={debt.key}>
              <div><span>{debt.name}</span><b>{debt.ownership}</b></div>
              <strong>{money(debt.balance)}</strong>
              <p>{debt.apr == null ? "APR unavailable" : `${debt.apr.toFixed(1)}% APR`} · {debt.minimum == null ? "minimum unavailable" : `${money(debt.minimum)} minimum`} · due {debt.due ?? "unknown"}</p>
              <small>{utilization == null ? "Utilization unavailable" : `${utilization.toFixed(1)}% utilization`}</small>
            </article>
          );
        })}
      </div>

      <div className="finance-section-head">
        <div><span>GOAL READINESS</span><strong>THE DESTINATIONS</strong></div>
        <small>{runtime?.mode === "DIRECT" ? "AUTO-RECALCULATING" : "REAL SNAPSHOT"}</small>
      </div>

      <div className="finance-goal-grid">
        {goals.map((goal) => (
          <article key={goal.name} className={`finance-goal-card ${goalClass(goal.state)}`}>
            <div className="finance-goal-head"><span>{goal.name}</span><b>{goal.state}</b></div>
            <strong>{goal.current}</strong>
            <small>Target: {goal.target}</small>
            {goal.progress != null && (
              <div className="finance-goal-bar"><i style={{ width: `${Math.max(0, Math.min(100, goal.progress))}%` }} /></div>
            )}
            <p>{goal.progress == null ? "" : `${goal.progress.toFixed(1)}% · `}{goal.blocker}</p>
          </article>
        ))}
      </div>

      <div className="finance-section-head">
        <div><span>ACCOUNT ARCHITECTURE</span><strong>EVERY ACCOUNT HAS A JOB</strong></div>
        <small>{runtime?.accountCount ?? FINANCE_SNAPSHOT.accountCount} ACCOUNTS</small>
      </div>

      <div className="account-role-grid">
        {accountGroups.map((account, index) => (
          <article className="account-role-card" key={`${account.institution}-${account.role}-${index}`}>
            <div className="account-role-top"><span>{account.institution}</span><b>MAPPED</b></div>
            <strong>{account.role}</strong>
            <p>{account.detail}</p>
          </article>
        ))}
      </div>

      <div className="finance-roadmap">
        <ShieldCheck size={15} />
        <div>
          <span>HOW JARVIS OPERATES</span>
          <strong>SEE THE MONEY → KNOW THE STAGE → IDENTIFY THE BLOCKER → ACT WITHIN AUTHORITY → MEASURE → REPEAT</strong>
        </div>
      </div>

      <div className="finance-source-note">
        <ShieldCheck size={13} />
        <span>{runtime?.note ?? FINANCE_SNAPSHOT.note}</span>
      </div>
    </section>
  );
}

function Metric({ label, value, note, emphasis = false }: { label: string; value: string; note: string; emphasis?: boolean }) {
  return (
    <div className={`finance-metric ${emphasis ? "net-worth-metric" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

export function FinanceGoalMiniList() {
  const runtime = useFinanceRuntime();
  const goals = runtime?.goals ?? FINANCE_GOALS;

  return (
    <div className="finance-mini-goals">
      {goals.slice(0, 4).map((goal) => (
        <div key={goal.name} className={goalClass(goal.state)}>
          <div><span>{goal.name}</span><b>{goal.progress == null ? goal.state : `${Math.round(goal.progress)}%`}</b></div>
          {goal.progress != null ? <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, goal.progress))}%` }} /></div> : <small>{goal.current}</small>}
        </div>
      ))}
      <div className="finance-mini-proof"><CheckCircle2 size={12} /> {runtime?.mode === "DIRECT" ? "Direct Finance state · auto-recalculating" : "Real synchronized snapshot · direct feed ready"}</div>
    </div>
  );
}
