"use client";

import { CheckCircle2, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FinanceRuntimeState } from "../lib/jarvis-runtime";
import { deriveFinanceFocus } from "../lib/finance-focus";
import {
  FINANCE_ACCOUNT_PURPOSES,
  FINANCE_DEBTS,
  FINANCE_GOALS,
  FINANCE_SNAPSHOT,
  FINANCE_STAGES,
} from "../lib/finance-snapshot";
import styles from "./finance-focus.module.css";

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
        // Keep the last known finance state visible.
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

  const focus = runtime
    ? deriveFinanceFocus(runtime)
    : {
        stage: "DEBT",
        title: "CLEAR PERSONAL REVOLVING DEBT",
        reason: `${money(metrics.personalDebt)} of personal revolving debt is the current financial drag.`,
        nextStep: "Protect enough operating cash to avoid recreating debt, then route the next safe debt dollar to the RBFCU World Card first while its known APR and utilization remain the strongest debt signal.",
        moneyInRule: "New money gets assigned before it gets spent.",
        moneyOutRule: "Discretionary spending is challenged when it delays the active debt target.",
        targetLabel: "RBFCU WORLD CARD",
      };

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

  const activeDebt = useMemo(
    () => debts.find((debt) => debt.name.toUpperCase().includes(focus.targetLabel.replace("RBFCU ", "").toUpperCase())) ?? null,
    [debts, focus.targetLabel],
  );

  const activeUtilization = activeDebt?.limit
    ? Math.min(999, (activeDebt.balance / activeDebt.limit) * 100)
    : null;

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

  return (
    <section className="finance-cockpit finance-operating-system">
      <div className="finance-titlebar">
        <div>
          <span>DWIGHT // CAPITAL CONTROL</span>
          <strong>FINANCE // $100M CASH PATH</strong>
        </div>
        <div className="finance-sync"><i /> {syncLabel}</div>
      </div>

      <div className="finance-metrics">
        <Metric label="ADJUSTED NET WORTH" value={signedMoney(metrics.personalNetWorth)} note="Authorized-user debt excluded." emphasis />
        <Metric label="CASH" value={money(metrics.liquidity)} note="Current connected depository cash." />
        <Metric label="PERSONAL DEBT" value={money(metrics.personalDebt)} note="Revolving debt Jarvis is attacking." />
        <Metric label="STAGE" value={currentStage} note={`Next: ${nextStage}.`} />
      </div>

      <section className={styles.focusHero} aria-label="Jarvis current finance focus">
        <div className={styles.focusTopline}>
          <span>JARVIS // ONE FOCUS NOW</span>
          <b>{focus.stage}</b>
        </div>
        <h2>{focus.title}</h2>
        <p className={styles.why}>{focus.reason}</p>

        <div className={styles.targetStrip}>
          <span>CURRENT TARGET</span>
          <strong>{focus.targetLabel}</strong>
          {activeDebt && (
            <small>
              {money(activeDebt.balance)}
              {activeDebt.apr != null ? ` · ${activeDebt.apr.toFixed(1)}% APR` : ""}
              {activeUtilization != null ? ` · ${activeUtilization.toFixed(1)}% utilized` : ""}
            </small>
          )}
        </div>

        <div className={styles.nextStep}>
          <span>NEXT RIGHT STEP</span>
          <strong>{focus.nextStep}</strong>
        </div>

        <div className={styles.moneyRules}>
          <div>
            <span>WHEN MONEY COMES IN</span>
            <p>{focus.moneyInRule}</p>
          </div>
          <div>
            <span>WHEN MONEY GOES OUT</span>
            <p>{focus.moneyOutRule}</p>
          </div>
        </div>
      </section>

      <section className={styles.watchPanel} aria-label="Jarvis money watch rules">
        <div className={styles.watchHeader}>
          <div>
            <span>JARVIS MONEY WATCH</span>
            <strong>EVERY MATERIAL MONEY MOVE GETS JUDGED AGAINST THE ONE FOCUS</strong>
          </div>
          <small>HOURLY MONITOR ACTIVE</small>
        </div>
        <div className={styles.verdictGrid}>
          <article className={styles.aligned}>
            <b>ALIGNED</b>
            <span>Debt payments, required obligations, and new income that is assigned before lifestyle spending.</span>
          </article>
          <article className={styles.review}>
            <b>REVIEW</b>
            <span>Transfers, ambiguous deposits, or business-account spending that needs context before Jarvis judges it.</span>
          </article>
          <article className={styles.misaligned}>
            <b>MISALIGNED</b>
            <span>Discretionary leakage or new revolving charges that slow the active target while debt remains.</span>
          </article>
        </div>
        <p className={styles.watchNote}>ChatGPT-side account monitoring is active now. The website will show individual transaction judgments automatically once the direct transaction feed is connected.</p>
      </section>

      <div className="finance-section-head">
        <div><span>PATH</span><strong>DEBT → STABILITY → RESERVES → CREDIT → CAPITAL → INVESTING → ASSETS</strong></div>
        <small>ONE FOCUS AT A TIME</small>
      </div>
      <div className="finance-stage-row">
        {FINANCE_STAGES.map((stage) => (
          <div key={stage} className={stage === currentStage ? "active" : ""}><span>{stage}</span></div>
        ))}
      </div>

      <div className="finance-section-head">
        <div><span>DEBT</span><strong>CURRENT TARGETS</strong></div>
        <small>{money(metrics.personalDebt)} PERSONAL</small>
      </div>
      <div className="finance-debt-grid">
        {debts.map((debt) => {
          const utilization = debt.limit ? Math.min(999, (debt.balance / debt.limit) * 100) : null;
          return (
            <article className={`finance-debt-card ${debt.ownership === "AUTHORIZED_USER" ? "au" : ""}`} key={debt.key}>
              <div><span>{debt.name}</span><b>{debt.ownership}</b></div>
              <strong>{money(debt.balance)}</strong>
              <p>{debt.apr == null ? "APR unknown" : `${debt.apr.toFixed(1)}% APR`} · {utilization == null ? "utilization unknown" : `${utilization.toFixed(1)}% utilization`}</p>
              <small>{debt.minimum == null ? "Minimum unknown" : `${money(debt.minimum)} minimum`} · due {debt.due ?? "unknown"}</small>
            </article>
          );
        })}
      </div>

      <div className="finance-section-head">
        <div><span>GOALS</span><strong>MEASURED DESTINATIONS</strong></div>
        <small>{runtime?.mode === "DIRECT" ? "AUTO" : "SNAPSHOT"}</small>
      </div>
      <div className="finance-goal-grid">
        {goals.map((goal) => (
          <article key={goal.name} className={`finance-goal-card ${goalClass(goal.state)}`}>
            <div className="finance-goal-head"><span>{goal.name}</span><b>{goal.state}</b></div>
            <strong>{goal.current}</strong>
            <small>Target: {goal.target}</small>
            {goal.progress != null && <div className="finance-goal-bar"><i style={{ width: `${Math.max(0, Math.min(100, goal.progress))}%` }} /></div>}
            <p>{goal.progress == null ? "" : `${goal.progress.toFixed(goal.progress < 1 ? 3 : 1)}% · `}{goal.blocker}</p>
          </article>
        ))}
      </div>

      <div className="finance-section-head">
        <div><span>ACCOUNTS</span><strong>EVERY ACCOUNT HAS A JOB</strong></div>
        <small>{runtime?.accountCount ?? FINANCE_SNAPSHOT.accountCount}</small>
      </div>
      <div className="account-role-grid">
        {accountGroups.map((account, index) => (
          <article className="account-role-card" key={`${account.institution}-${account.role}-${index}`}>
            <div className="account-role-top"><span>{account.institution}</span><b>{account.role}</b></div>
            <p>{account.detail}</p>
          </article>
        ))}
      </div>

      <div className="finance-source-note">
        <ShieldCheck size={13} />
        <span>Jarvis leads from the active stage, changes the focus only when the numbers justify it, and keeps $100M cash as the long-horizon destination.</span>
      </div>
    </section>
  );
}

function Metric({ label, value, note, emphasis = false }: { label: string; value: string; note: string; emphasis?: boolean }) {
  return (
    <div className={`finance-metric ${emphasis ? "net-worth-metric" : ""}`}>
      <span>{label}</span><strong>{value}</strong><small>{note}</small>
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
      <div className="finance-mini-proof"><CheckCircle2 size={12} /> ONE FOCUS · Jarvis leads from the active stage</div>
    </div>
  );
}
