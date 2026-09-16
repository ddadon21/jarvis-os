"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";
import {
  FINANCE_ACCOUNT_PURPOSES,
  FINANCE_DEBTS,
  FINANCE_GOALS,
  FINANCE_SNAPSHOT,
  FINANCE_STAGES,
} from "../lib/finance-snapshot";

type FinanceView = "OVERVIEW" | "CASH FLOW" | "DEBT" | "GOALS" | "ACCOUNTS" | "DECISIONS";

const FINANCE_VIEWS: FinanceView[] = ["OVERVIEW", "CASH FLOW", "DEBT", "GOALS", "ACCOUNTS", "DECISIONS"];

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

export default function FinanceCockpit({ onAsk }: { onAsk: (prompt: string) => void }) {
  const [view, setView] = useState<FinanceView>("OVERVIEW");

  return (
    <section className="finance-cockpit finance-operating-system">
      <div className="finance-titlebar">
        <div>
          <span>HIMIE JOHNSON VENTURES // DWIGHT</span>
          <strong>FINANCE // CFO OPERATING SYSTEM</strong>
        </div>
        <div className="finance-sync"><i /> PHASE 1 COMPLETE · 7 CONNECTIONS · 11 ACCOUNTS</div>
      </div>

      <nav className="finance-subnav" aria-label="Finance workspace">
        {FINANCE_VIEWS.map((item) => (
          <button key={item} type="button" className={view === item ? "active" : ""} onClick={() => setView(item)}>
            {item}
          </button>
        ))}
      </nav>

      {view === "OVERVIEW" && <Overview onAsk={onAsk} />}
      {view === "CASH FLOW" && <CashFlow onAsk={onAsk} />}
      {view === "DEBT" && <Debt onAsk={onAsk} />}
      {view === "GOALS" && <Goals onAsk={onAsk} />}
      {view === "ACCOUNTS" && <Accounts />}
      {view === "DECISIONS" && <Decisions onAsk={onAsk} />}

      <div className="finance-source-note">
        <ShieldCheck size={13} />
        <span>{FINANCE_SNAPSHOT.note}</span>
      </div>
    </section>
  );
}

function Overview({ onAsk }: { onAsk: (prompt: string) => void }) {
  return (
    <>
      <div className="finance-metrics">
        <Metric label="ADJUSTED NET WORTH" value={signedMoney(FINANCE_SNAPSHOT.personalNetWorth)} note="Authorized-user balance excluded from Dwight's working liability total." emphasis />
        <Metric label="LIQUIDITY" value={money(FINANCE_SNAPSHOT.liquidity)} note="Connected checking + savings cash." />
        <Metric label="PERSONAL DEBT" value={money(FINANCE_SNAPSHOT.personalDebt)} note={`${money(FINANCE_SNAPSHOT.authorizedUserBalance)} AU balance tracked separately.`} />
        <Metric label="SEP SPEND" value={money(FINANCE_SNAPSHOT.septemberSpend)} note="Category-based posted spending snapshot." />
      </div>

      <div className="finance-section-head">
        <div><span>CAPITAL STAGE</span><strong>DEBT → STABILITY → RESERVES → CREDIT → CAPITAL → INVESTING → ASSETS</strong></div>
        <small>CURRENT: {FINANCE_SNAPSHOT.currentStage}</small>
      </div>
      <div className="finance-stage-row">
        {FINANCE_STAGES.map((stage) => (
          <div key={stage} className={stage === FINANCE_SNAPSHOT.currentStage ? "active" : ""}>
            <span>{stage}</span>
          </div>
        ))}
      </div>

      <div className="finance-operating-grid">
        <article className="finance-action-card priority">
          <span>CFO PRIORITY</span>
          <strong>Eliminate personal revolving debt without draining operating liquidity.</strong>
          <p>Known personal balance is {money(FINANCE_SNAPSHOT.personalDebt)}. The World Card has the highest known APR at 18%; Quicksilver's APR still needs confirmation before a final payoff order is locked.</p>
          <button type="button" onClick={() => onAsk("Build my current debt payoff plan using my real balances, APRs, due dates, liquidity, and the fact that the Platinum Premier card is authorized-user debt.")}>BUILD DEBT PLAN <ArrowRight size={12} /></button>
        </article>
        <article className="finance-action-card">
          <span>DATA QUALITY</span>
          <strong>History is ready. Classification is now the work.</strong>
          <p>Transactions and recurring history are available. Gross credits should not be called income until transfers, payouts, refunds, and real earnings are separated.</p>
          <button type="button" onClick={() => onAsk("Reconcile my September inflows and classify real income, business revenue, transfers, refunds, and ambiguous deposits before calculating cash flow.")}>CLASSIFY CASH FLOW <ArrowRight size={12} /></button>
        </article>
        <article className="finance-action-card">
          <span>GOAL ENGINE</span>
          <strong>Stop using decorative readiness percentages.</strong>
          <p>$10K liquidity is measurable now. Move Out and GR Supra stay in setup until their actual pass/fail criteria are defined.</p>
          <button type="button" onClick={() => onAsk("Help me define hard readiness criteria for moving out and buying a GR Supra so Jarvis can calculate real red, yellow, and green status.")}>DEFINE READINESS GATES <ArrowRight size={12} /></button>
        </article>
        <article className="finance-action-card">
          <span>NEXT DOLLAR ENGINE</span>
          <strong>Classify → protect → attack → reserve → compound.</strong>
          <p>When new money arrives, Jarvis should identify the source first, protect required bills/taxes, attack the right debt, then route excess capital to reserves and investing according to the active stage.</p>
          <button type="button" onClick={() => onAsk("Design my next-dollar allocation rules using my real accounts and current debt-first stage. Do not invent tax percentages or reserve targets I have not approved.")}>DESIGN MONEY ROUTER <ArrowRight size={12} /></button>
        </article>
      </div>
    </>
  );
}

function CashFlow({ onAsk }: { onAsk: (prompt: string) => void }) {
  return (
    <>
      <div className="finance-metrics finance-metrics-three">
        <Metric label="SEP CATEGORY SPEND" value={money(FINANCE_SNAPSHOT.septemberSpend)} note="Current-month spending view from connected transaction categories." emphasis />
        <Metric label="GROSS CREDITS DETECTED" value={money(FINANCE_SNAPSHOT.septemberCreditsDetected)} note={`Posted through ${FINANCE_SNAPSHOT.creditsPostedThrough}; mostly transfer-labeled and not treated as income.`} />
        <Metric label="FREE CASH FLOW" value="NOT LOCKED" note="Requires reconciled income + economic spending, not raw account movement." />
      </div>
      <div className="finance-explainer">
        <span>CASH FLOW CONTROL</span>
        <strong>Jarvis should never confuse transfers with income or card payments with new spending.</strong>
        <p>The next finance data task is to establish clean monthly economics: true earnings, business revenue, refunds/reimbursements, internal transfers, debt payments, real consumption, and investable surplus.</p>
      </div>
      <button className="finance-primary-action" type="button" onClick={() => onAsk("Create a clean September cash-flow statement from my connected accounts. Reconcile every material inflow first and separate transfers, card payments, refunds, business revenue, and personal income.")}>RECONCILE SEPTEMBER CASH FLOW <ArrowRight size={13} /></button>
    </>
  );
}

function Debt({ onAsk }: { onAsk: (prompt: string) => void }) {
  return (
    <>
      <div className="finance-section-head">
        <div><span>LIABILITY CONTROL</span><strong>PERSONAL DEBT VS. AUTHORIZED-USER EXPOSURE</strong></div>
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
      <div className="finance-explainer">
        <span>PAYOFF LOGIC</span>
        <strong>Known APR alone is not enough to automate the order.</strong>
        <p>World Card is 18%. Quicksilver's APR is missing. The Platinum Premier balance is tracked for credit context but excluded from Dwight's working personal debt because it is authorized-user debt.</p>
      </div>
      <button className="finance-primary-action" type="button" onClick={() => onAsk("Use my current liabilities to build a debt payoff order. Flag the missing Quicksilver APR instead of guessing it, preserve a liquidity floor, and treat Platinum Premier as authorized-user debt.")}>BUILD PAYOFF ORDER <ArrowRight size={13} /></button>
    </>
  );
}

function Goals({ onAsk }: { onAsk: (prompt: string) => void }) {
  return (
    <>
      <div className="finance-goal-grid">
        {FINANCE_GOALS.map((goal) => (
          <article key={goal.name} className={`finance-goal-card ${goalClass(goal.state)}`}>
            <div className="finance-goal-head"><span>{goal.name}</span><b>{goal.state}</b></div>
            <strong>{goal.current}</strong>
            <small>Target: {goal.target}</small>
            {goal.progress != null && (
              <div className="finance-goal-bar"><i style={{ width: `${Math.max(0, Math.min(100, goal.progress))}%` }} /></div>
            )}
            <p>{goal.progress == null ? "No fake percentage · " : `${goal.progress.toFixed(1)}% · `}{goal.blocker}</p>
          </article>
        ))}
      </div>
      <button className="finance-primary-action" type="button" onClick={() => onAsk("Lock the formulas and pass/fail criteria for my finance goals: debt freedom, $10K liquid, move out, GR Supra, $100K net worth, and $1M net worth.")}>LOCK GOAL FORMULAS <ArrowRight size={13} /></button>
    </>
  );
}

function Accounts() {
  return (
    <>
      <div className="finance-section-head">
        <div><span>ACCOUNT ARCHITECTURE</span><strong>EVERY ACCOUNT HAS ONE PRIMARY JOB</strong></div>
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
      <div className="finance-explainer">
        <span>CONTROL RULE</span>
        <strong>Accounts are infrastructure, not goals.</strong>
        <p>Jarvis should route money based on the active financial stage and each account's purpose, while keeping business, personal, reserve, investing, and credit roles distinct.</p>
      </div>
    </>
  );
}

function Decisions({ onAsk }: { onAsk: (prompt: string) => void }) {
  const decisions = [
    { title: "MOVE OUT", state: "SETUP", text: "Needs housing budget, move-in capital, emergency reserve, income consistency, and debt/credit gates.", prompt: "Define my Move Out readiness gate from my real finances. Give every criterion a measurable threshold and explain what data is still missing." },
    { title: "GR SUPRA", state: "SETUP", text: "Needs purchase price, down payment, insurance, financing, post-purchase liquidity, and opportunity-cost gates.", prompt: "Define my GR Supra readiness gate using real affordability constraints, cash after purchase, insurance, debt, credit, and wealth-building impact." },
    { title: "PAY DEBT TODAY?", state: "ACTIVE", text: "Decision should compare due dates, APR, utilization, operating liquidity, and reserve floor.", prompt: "Given my current balances and liquidity, evaluate whether I should make an extra debt payment now and which card should receive it. Do not guess missing APRs." },
    { title: "INVEST OR HOLD CASH?", state: "LOCKED", text: "Debt-first stage means investing should not outrun liquidity protection and high-cost debt removal.", prompt: "Evaluate when new money should go to debt, cash reserves, or investing based on my current stage and actual balances." },
  ];
  return (
    <div className="finance-decision-list">
      {decisions.map((decision) => (
        <article key={decision.title}>
          <div><span>{decision.title}</span><b>{decision.state}</b></div>
          <p>{decision.text}</p>
          <button type="button" onClick={() => onAsk(decision.prompt)}>RUN DECISION <ArrowRight size={12} /></button>
        </article>
      ))}
    </div>
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
      <div className="finance-mini-proof"><CheckCircle2 size={12} /> Only measurable goals get percentages.</div>
    </div>
  );
}
