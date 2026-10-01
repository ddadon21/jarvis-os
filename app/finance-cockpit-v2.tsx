"use client";

import { ArrowUpRight, ArrowDownRight, RefreshCw, ShieldCheck, Wallet, Target, CircleAlert, Landmark, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { FinanceRuntimeState, FinanceAccountState } from "../lib/jarvis-runtime";
import { FINANCE_IMPORT } from "../lib/finance-import";
import { FINANCE_STAGES, getNextNetWorthMilestone } from "../lib/finance-snapshot";
import { financeTotals, payoutMath, EMPTY_PAYOUT_PLAN, PLAN_FIELDS, type PayoutPlan } from "../lib/finance-math";
import s from "./finance-capital.module.css";

const money = (v: number | null) => v == null ? "UNKNOWN" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
const stamp = (v?: string | null) => v && Number.isFinite(Date.parse(v)) ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(v)) + " CT" : "Not supplied";
const dateOnly = (v?: string | null) => v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(v + "T12:00:00Z")) : "Not supplied";
const PLAN_KEY = "jarvis-finance-payout-plan-v1";
const allocations = { tax: ["TAX RESERVE", "Enter your own reserve amount"], bills: ["BILLS + MINIMUMS", "Required obligations"], reserve: ["CASH RESERVE", "Cash you intend to keep"], debt: ["EXTRA DEBT PAYMENT", "Beyond the minimums above"], business: ["BUSINESS CAPITAL", "Planned operating needs"] } as const;
type View = "OVERVIEW" | "PAYOUT PLAN" | "ACCOUNTS + DATA";

const CAPITAL_STAGE_DETAILS: Record<(typeof FINANCE_STAGES)[number], string> = {
  DEBT: "Eliminate personal revolving debt without destabilizing operating cash.",
  STABILITY: "Cover obligations reliably and make monthly cash flow predictable.",
  RESERVES: "Build a durable cash floor before expanding lifestyle or risk.",
  CREDIT: "Strengthen revolving-credit health while keeping balances controlled.",
  CAPITAL: "Stack deployable cash and business capital for asymmetric opportunities.",
  INVESTING: "Build long-term ownership through disciplined, repeatable investing.",
  ASSETS: "Acquire durable assets only when the cash base and leverage can support them.",
};

export default function FinanceCockpitV2() {
  const [runtime, setRuntime] = useState<FinanceRuntimeState | null>(null);
  const [view, setView] = useState<View>("OVERVIEW");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [plan, setPlan] = useState<PayoutPlan>(EMPTY_PAYOUT_PLAN);
  const [saved, setSaved] = useState("");
  const [selectedCapitalStage, setSelectedCapitalStage] = useState<(typeof FINANCE_STAGES)[number] | null>(null);
  const refresh = useCallback(async (manual = false, signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch("/api/finance/state", { cache: "no-store", signal });
      if (!response.ok) throw Error("unavailable");
      const body = await response.json();
      if (!body.state?.accounts || !body.state?.metrics) throw Error("invalid");
      if (signal?.aborted) return;
      setRuntime(body.state);
      setMessage(manual ? "Latest Jarvis data loaded. This button does not force a bank refresh." : "");
    } catch {
      if (!signal?.aborted) setMessage("Refresh unavailable. Showing the last imported snapshot with its original dates.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(false, controller.signal);
    const timer = window.setInterval(() => void refresh(false, controller.signal), 60_000);
    try {
      const raw = JSON.parse(localStorage.getItem(PLAN_KEY) ?? "null");
      if (raw && typeof raw === "object") {
        const restored = { ...EMPTY_PAYOUT_PLAN };
        for (const key of Object.keys(restored) as (keyof PayoutPlan)[]) if (typeof raw[key] === "string" && raw[key].length < 120) restored[key] = raw[key];
        setPlan(restored);
      }
    } catch { /* A blocked or invalid local store must not prevent Finance loading. */ }
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [refresh]);

  const accounts: FinanceAccountState[] = runtime?.accounts ?? FINANCE_IMPORT.accounts;
  const liabilities = runtime?.liabilities ?? FINANCE_IMPORT.liabilities;
  const totals = financeTotals(accounts);
  const asOf = runtime?.asOf ?? FINANCE_IMPORT.asOf;
  const stage = runtime?.currentStage ?? (totals.personalDebt > 0 ? "DEBT" : "STABILITY");
  const capitalStage = (selectedCapitalStage ?? stage) as (typeof FINANCE_STAGES)[number];
  const debts = accounts.filter(a => a.type === "credit" || a.type === "loan");
  const personal = debts.filter(a => a.ownership !== "AUTHORIZED_USER");
  const banks = accounts.filter(a => a.type === "depository");
  const debtTarget = personal.find(a => a.key === plan.target);
  const projection = payoutMath(plan, debtTarget?.current ?? null);
  const milestone = getNextNetWorthMilestone(totals.personalNetWorth);
  const unknownApr = personal.filter(a => liabilities.find(l => l.accountKey === a.key)?.apr == null);
  const missingNames = [!accounts.some(a => /capital.*one/i.test(a.institution) && /platinum/i.test(a.name)) ? "Capital One Platinum" : null,
    !accounts.some(a => /roth/i.test(`${a.name} ${a.subtype}`)) ? "Roth IRA" : null].filter(Boolean);
  const bankFreshnessUnknown = banks.some(a => !a.balanceAsOf);
  const receiptDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(asOf));
  const updatePlan = (key: keyof PayoutPlan, value: string) => { setPlan(p => ({ ...p, [key]: value })); setSaved(""); };
  function savePlan() {
    if (projection.error) return;
    try { localStorage.setItem(PLAN_KEY, JSON.stringify(plan)); window.dispatchEvent(new Event("jarvis-obsidian-sync-now")); setSaved("Saved to local cache; JARVIS Cloud and Obsidian sync follow automatically. No money moved."); }
    catch { setSaved("Storage unavailable. Your draft remains open but is not saved."); }
  }

  return <section className={s.finance} aria-label="Finance capital control">
    <header className={s.header}>
      <div><span className={s.eyebrow}>FINANCE</span><h2>CAPITAL CONTROL</h2><p>Protect the base. Clear the debt. Build ownership.</p></div>
      <div className={s.sync}><span><i />{runtime?.mode === "DIRECT" ? "DIRECT PROVIDER" : "CONNECTED SNAPSHOT"}</span><small>Imported {stamp(asOf)}</small><button onClick={() => void refresh(true)} disabled={loading}><RefreshCw size={11} />{loading ? "LOADING" : "RELOAD DATA"}</button></div>
    </header>
    {message && <p className={s.notice} role="status">{message}</p>}
    <div className={s.metrics}>
      <Metric label="AVAILABLE CASH" value={money(totals.availableCash)} note={totals.missingAvailable ? `${totals.missingAvailable} bank balances unavailable` : "Reported available · all bank accounts"} accent />
      <Metric label="PERSONAL DEBT" value={money(totals.personalDebt)} note="Authorized-user debt excluded" />
      <Metric label="ADJUSTED NET WORTH" value={money(totals.personalNetWorth)} note="Bank balances + investments − own debt" />
      <Metric label="BANK BALANCES" value={money(totals.liquidity)} note="Reported current · not all available" />
    </div>
    <nav className={s.tabs} aria-label="Finance views">{(["OVERVIEW", "PAYOUT PLAN", "ACCOUNTS + DATA"] as View[]).map(t => <button key={t} aria-current={view === t ? "page" : undefined} onClick={() => setView(t)}>{t}</button>)}</nav>

    {view === "OVERVIEW" && <>
      <section className={`${s.panel} ${s.focus}`}>
        <div className={s.panelHead}><h3><Target size={13} />ONE FOCUS NOW</h3><span>{stage}</span></div>
        <h3 className={s.focusTitle}>{totals.personalDebt > 0 ? "PROTECT CASH. CLEAR PERSONAL DEBT." : "BUILD YOUR CASH FOUNDATION."}</h3>
        <p>{totals.personalDebt > 0 ? `${money(totals.personalDebt)} remains on your personal cards. Plan the next received payout around obligations, cash reserves, and a deliberate debt payment.` : "Keep required obligations covered and build toward the next cash milestone."}</p>
        <div className={s.actionRow}><button onClick={() => setView("PAYOUT PLAN")}>PLAN THE NEXT PAYOUT <ArrowUpRight size={12} /></button><button onClick={() => setView("ACCOUNTS + DATA")}>REVIEW ACCOUNT DATA</button></div>
      </section>
      <div className={s.columns}>
        <section className={s.panel}>
          <div className={s.panelHead}><h3><Wallet size={13} />CASH POSITION</h3><span>REPORTED / AVAILABLE</span></div>
          <div className={s.chart} role="img" aria-label={`Reported bank balances ${money(totals.liquidity)}; available cash ${money(totals.availableCash)}. A balance comparison, not a historical chart.`}>
            <div className={s.chartRow}><span>BANK BALANCES</span><b>{money(totals.liquidity)}</b></div><div className={s.track}><i style={{ width: "100%", background: "#777" }} /></div>
            <div className={s.chartRow}><span>AVAILABLE CASH</span><b>{money(totals.availableCash)}</b></div><div className={s.track}><i style={{ width: `${totals.availableCash == null || totals.liquidity <= 0 ? 0 : Math.max(0, Math.min(100, totals.availableCash / totals.liquidity * 100))}%` }} /></div>
            <div className={s.chartGrid}><div><span>BUSINESS BALANCE</span><b>{money(totals.businessCash)}</b></div><div><span>PERSONAL BALANCES</span><b>{money(totals.personalCash)}</b></div><div><span>INVESTMENTS</span><b>{money(totals.investmentValue)}</b></div></div>
          </div>
          <p className={s.muted}>A reported balance is not a spending allowance. Confirm bank availability before assigning existing cash.</p>
        </section>
        <section className={s.panel}>
          <div className={s.panelHead}><h3><CircleAlert size={13} />NEXT ACTIONS</h3><span>DATA → DECISION</span></div>
          <Action number="01" title="Check available cash" text={`${money(totals.availableCash)} reported available across linked banks. Review the balance difference before a payment.`} />
          <Action number="02" title="Confirm card obligations" text={unknownApr.length ? `${unknownApr.map(a => a.name).join(", ")} has no reported APR. The cheapest payoff order cannot be confirmed yet.` : "Review the latest statement minimums and due dates before assigning extra debt payments."} />
          <Action number="03" title="Assign the next received payout" text="Use the planner to give each dollar a job. A saved plan never changes your actual balances." />
        </section>
      </div>
      <section className={s.panel}>
        <div className={s.panelHead}><h3><ArrowDownRight size={13} />DEBT CONTROL</h3><span>{personal.length} OWN · {debts.length - personal.length} AUTHORIZED USER</span></div>
        <div className={s.debts}>{debts.map(a => {
          const liability = liabilities.find(l => l.accountKey === a.key);
          const utilization = a.limit && a.limit > 0 ? Math.max(0, a.current) / a.limit * 100 : null;
          const oldDue = liability?.due && liability.due < receiptDay;
          return <article key={a.key} className={a.ownership === "AUTHORIZED_USER" ? s.au : s.debt}>
            <div className={s.debtHead}><h4>{a.name}</h4><span>{a.ownership === "AUTHORIZED_USER" ? "AU · SEPARATE" : "PERSONAL"}</span></div>
            <strong>{money(a.current)}</strong><div className={s.track}><i style={{ width: `${Math.min(100, utilization ?? 0)}%` }} /></div>
            <p>{utilization == null ? "Limit / utilization unknown" : `${utilization.toFixed(1)}% utilized · ${money(a.limit)} limit`}</p>
            <dl><div><dt>Purchase APR</dt><dd>{liability?.apr == null ? "Not supplied" : `${liability.apr}%`}</dd></div><div><dt>Statement minimum</dt><dd>{money(liability?.minimum ?? null)}</dd></div><div><dt>Reported due date</dt><dd>{dateOnly(liability?.due)}</dd></div><div><dt>Statement issued</dt><dd>{dateOnly(liability?.statementDate)}</dd></div></dl>
            {oldDue && <p className={s.review}>Past reported due date. Confirm the latest statement and payment status.</p>}
            {a.ownership !== "AUTHORIZED_USER" && a.current > 0 && <button onClick={() => { updatePlan("target", a.key); setView("PAYOUT PLAN"); }}>PLAN A PAYMENT <ArrowUpRight size={11} /></button>}
          </article>;
        })}</div>
      </section>
      <section className={s.panel}>
        <div className={s.panelHead}><h3><Target size={13} />THE CAPITAL PATH</h3><span>LONG HORIZON · $100M CASH</span></div>
        <div className={s.stages}>{FINANCE_STAGES.map(t => (
          <button
            key={t}
            type="button"
            aria-current={t === capitalStage ? "step" : undefined}
            onClick={() => setSelectedCapitalStage(t)}
          >
            {t}
          </button>
        ))}</div>
        <p className={s.stageDetail}><strong>{capitalStage}</strong>{CAPITAL_STAGE_DETAILS[capitalStage]}</p>
        <div className={s.goals}>
          <Goal name="DEBT FREEDOM" value={money(totals.personalDebt)} target="$0" percent={totals.personalDebt <= 0 ? 100 : null} note="Remaining own debt. No invented payoff percentage." />
          <Goal name="$10K CASH" value={money(totals.liquidity)} target="$10,000" percent={totals.liquidity / 100} note="Reported bank balances; available cash shown above." />
          <Goal name="NEXT NET WORTH" value={money(totals.personalNetWorth)} target={money(milestone.target)} percent={milestone.progress} note="Advances in $5K steps until $100K, then $10K." />
        </div>
      </section>
    </>}

    {view === "PAYOUT PLAN" && <section className={s.panel}>
      <div className={s.panelHead}><h3><SlidersHorizontal size={13} />ASSIGN YOUR NEXT PAYOUT</h3><span>SCENARIO · NO MONEY MOVED</span></div>
      <p className={s.muted}>Enter a net payout and your own dollar allocations. Amounts are hypothetical until you receive and move the money. No tax percentage is assumed.</p>
      <div className={s.planner}>
        <div><label>NET PAYOUT ($)<input type="number" min="0" max="1000000000" step="0.01" inputMode="decimal" value={plan.payout} onChange={e => updatePlan("payout", e.target.value)} placeholder="0.00" /></label>
          <label>PERSONAL DEBT TARGET<select value={debtTarget ? plan.target : ""} onChange={e => updatePlan("target", e.target.value)}><option value="">Choose a card</option>{personal.filter(a => a.current > 0).map(a => <option key={a.key} value={a.key}>{a.name} · {money(a.current)}</option>)}</select></label>
          <div className={s.fields}>{PLAN_FIELDS.map(k => <label key={k}>{allocations[k][0]} ($)<input type="number" min="0" max="1000000000" step="0.01" inputMode="decimal" value={plan[k]} onChange={e => updatePlan(k, e.target.value)} placeholder="0.00" /><small>{allocations[k][1]}</small></label>)}</div>
        </div>
        <aside className={s.planSummary} aria-live="polite"><span className={s.eyebrow}>YOUR PLAN</span><strong>{money(projection.remaining)}</strong><p>{projection.remaining < 0 ? "OVER ASSIGNED" : "UNASSIGNED"}</p>
          <dl><div><dt>Net payout</dt><dd>{money(projection.payout)}</dd></div><div><dt>Assigned</dt><dd>{money(projection.assigned)}</dd></div><div><dt>Target balance after extra payment</dt><dd>{projection.error ? "—" : money(projection.projectedDebt)}</dd></div></dl>
          <p className={s.muted}>Projection excludes future interest, charges, and any minimum payment assigned under bills. Actual account balances stay unchanged.</p>
          {projection.error && <p className={s.review}>{projection.error}</p>}
          <button disabled={Boolean(projection.error)} onClick={savePlan}>SAVE PLAN ON THIS BROWSER</button>
          <button onClick={() => { setPlan(EMPTY_PAYOUT_PLAN); try { localStorage.removeItem(PLAN_KEY); setSaved("Draft cleared locally and will be removed from JARVIS Cloud."); } catch { setSaved("Draft cleared; stored copy could not be removed."); } }}>CLEAR DRAFT</button>
          {saved && <p role="status">{saved}</p>}
        </aside>
      </div>
    </section>}

    {view === "ACCOUNTS + DATA" && <>
      <section className={s.panel}><div className={s.panelHead}><h3><Landmark size={13} />EVERY ACCOUNT HAS A JOB</h3><span>{accounts.length} ACCOUNTS · {runtime?.connectionCount ?? FINANCE_IMPORT.connectionCount} CONNECTIONS</span></div>
        <div className={s.tableWrap}><table><thead><tr><th>ACCOUNT / PURPOSE</th><th>CURRENT</th><th>AVAILABLE</th><th>LAST RECEIVED</th></tr></thead><tbody>{accounts.map(a => <tr key={a.key}><td><strong>{a.institution} · {a.name}</strong><small>{a.role} · {a.ownership.replaceAll("_", " ")}</small></td><td>{money(a.current)}{a.type === "credit" || a.type === "loan" ? <small>Owed</small> : null}</td><td>{money(a.available)}<small>{a.type === "credit" ? "Credit, not cash" : a.type === "investment" ? "Brokerage, not bank cash" : "Bank reported"}</small></td><td>{stamp(a.balanceUpdatedAt)}<small>Bank as of: {a.balanceAsOf ? stamp(a.balanceAsOf) : "not supplied"}</small></td></tr>)}</tbody></table></div>
      </section>
      <section className={s.panel}><div className={s.panelHead}><h3><ShieldCheck size={13} />DATA COVERAGE</h3><span>HONEST NUMBERS</span></div>
        <div className={s.coverage}><div><h4>Snapshot, with receipt dates</h4><p>{runtime?.source ?? FINANCE_IMPORT.source}. Imported {stamp(asOf)}. {bankFreshnessUnknown ? "The provider does not supply a confirmed bank effective time for every balance. Latest returned values are not guaranteed real-time." : "See each bank balance’s effective time above."}</p></div>
          {missingNames.length > 0 && <div><h4>Outside this connected set</h4><p>{missingNames.join(" and ")} not returned. No balance is assumed; these are excluded from totals.</p></div>}
          <div><h4>Authorized-user debt stays separate</h4><p>{money(totals.authorizedUserBalance)} is shown for credit context and excluded from personal debt and adjusted net worth.</p></div>
          <div><h4>No assumed payoff order</h4><p>{unknownApr.length ? `${unknownApr.map(a => a.name).join(", ")} APR is unavailable. ` : ""}Statement minimums and due dates are provider records; a past date alone does not establish that a payment is overdue.</p></div>
          <div><h4>Income and spending coverage</h4><p>Transactions and recurring bills are not imported into this dashboard. No spending total, payout total, or trend is invented from balance changes.</p></div>
          <div><h4>Refreshing Jarvis</h4><p>Reload data fetches the latest state saved in Jarvis. In snapshot mode, connected-account refreshes must be imported again to update this page.</p></div>
        </div>
      </section>
    </>}
    <footer className={s.footer}><ShieldCheck size={12} /><span>{bankFreshnessUnknown ? "Bank effective times unconfirmed" : "Source times shown per account"} · {runtime?.mode === "DIRECT" ? "Direct provider data" : "Latest imported snapshot"} · Plans never execute payments.</span></footer>
  </section>;
}
function Metric({ label, value, note, accent = false }: { label: string; value: string; note: string; accent?: boolean }) { return <div className={accent ? s.metricAccent : ""}><span>{label}</span><b>{value}</b><small>{note}</small></div>; }
function Action({ number, title, text }: { number: string; title: string; text: string }) { return <div className={s.action}><span>{number}</span><div><h4>{title}</h4><p>{text}</p></div></div>; }
function Goal({ name, value, target, percent, note }: { name: string; value: string; target: string; percent: number | null; note: string }) { return <article><span>{name}</span><strong>{value}</strong><small>Target {target}</small>{percent != null && <div className={s.track}><i style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} /></div>}<p>{percent == null ? "" : `${Math.max(0, Math.min(100, percent)).toFixed(1)}% · `}{note}</p></article>; }
