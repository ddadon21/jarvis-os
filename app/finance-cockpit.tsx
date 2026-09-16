"use client";

import { CheckCircle2, ShieldCheck } from "lucide-react";
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

export default function FinanceCockpit(_: { onAsk?: (prompt: string) => void }) {
  return (
    <section className="finance-cockpit finance-operating-system">
      <div className="finance-titlebar">
        <div>
          <span>HIMIE JOHNSON VENTURES // DWIGHT</span>
          <strong>FINANCE // THE PATH</strong>
        </div>
        <div className="finance-sync"><i /> PHASE 1 SYNCED · SNAPSHOT</div>
      </div>

      <div className="finance-metrics">
        <Metric
          label="ADJUSTED NET WORTH"
          value={signedMoney(FINANCE_SNAPSHOT.personalNetWorth)}
          note="Authorized-user balance excluded from Dwight's working liability total."
          emphasis
        />
        <Metric label="LIQUIDITY" value={money(FINANCE_SNAPSHOT.liquidity)} note="Connected checking + savings cash." />
        <Metric
          label="PERSONAL DEBT"
          value={money(FINANCE_SNAPSHOT.personalDebt)}
          note={`${money(FINANCE_SNAPSHOT.authorizedUserBalance)} authorized-user balance tracked separately.`}
        />
        <Metric label="CURRENT STAGE" value={FINANCE_SNAPSHOT.currentStage} note={`Next stage: ${FINANCE_SNAPSHOT.nextStage}.`} />
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
          <div key={stage} className={stage === FINANCE_SNAPSHOT.currentStage ? "active" : ""}>
            <span>{stage}</span>
          </div>
        ))}
      </div>

      <div className="finance-explainer">
        <span>JARVIS DIRECTIVE // NOW</span>
        <strong>Clear personal revolving debt while protecting enough cash to keep operating without creating new debt.</strong>
        <p>
          The current personal balance is {money(FINANCE_SNAPSHOT.personalDebt)}. The RBFCU World Card is the highest known APR at 18%.
          Quicksilver's APR is still missing, so Jarvis will not fake a mathematically final payoff order until that number is known.
        </p>
      </div>

      <div className="finance-operating-grid">
        <article className="finance-action-card priority">
          <span>NOW // DEBT</span>
          <strong>Remove the revolving balances.</strong>
          <p>Every new dollar is judged first by what must remain liquid, what is due, and what debt creates the most drag.</p>
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
        <small>{money(FINANCE_SNAPSHOT.personalDebt)} PERSONAL</small>
      </div>

      <div className="finance-debt-grid">
        {FINANCE_DEBTS.map((debt) => {
          const utilization = debt.limit ? Math.min(999, (debt.balance / debt.limit) * 100) : null;
          return (
            <article className={`finance-debt-card ${debt.ownership === "AUTHORIZED_USER" ? "au" : ""}`} key={debt.name}>
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
        <small>MEASURED, NOT DECORATIVE</small>
      </div>

      <div className="finance-goal-grid">
        {FINANCE_GOALS.map((goal) => (
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
        <small>6 PURPOSE GROUPS</small>
      </div>

      <div className="account-role-grid">
        {FINANCE_ACCOUNT_PURPOSES.map((account) => (
          <article className="account-role-card" key={account.institution}>
            <div className="account-role-top"><span>{account.institution}</span><b>MAPPED</b></div>
            <strong>{account.role}</strong>
            <p>{account.detail}</p>
          </article>
        ))}
      </div>

      <div className="finance-roadmap">
        <ShieldCheck size={15} />
        <div>
          <span>HOW JARVIS SHOULD OPERATE</span>
          <strong>SEE THE MONEY → KNOW THE STAGE → IDENTIFY THE BLOCKER → ACT WITHIN AUTHORITY → MEASURE → REPEAT</strong>
        </div>
      </div>

      <div className="finance-source-note">
        <ShieldCheck size={13} />
        <span>{FINANCE_SNAPSHOT.note}</span>
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
  return (
    <div className="finance-mini-goals">
      {FINANCE_GOALS.slice(0, 4).map((goal) => (
        <div key={goal.name} className={goalClass(goal.state)}>
          <div><span>{goal.name}</span><b>{goal.progress == null ? goal.state : `${Math.round(goal.progress)}%`}</b></div>
          {goal.progress != null ? <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, goal.progress))}%` }} /></div> : <small>{goal.current}</small>}
        </div>
      ))}
      <div className="finance-mini-proof"><CheckCircle2 size={12} /> Jarvis tracks the path and the blocker without adding extra choices.</div>
    </div>
  );
}
