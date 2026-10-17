"use client";

import { useEffect, useMemo, useState } from "react";
import type { FinanceAccountState } from "../lib/jarvis-runtime";
import s from "./finance-capital.module.css";

type Card = { id: string; name: string; balance: number; limit: number | null; apr: number | null; minimum: number; destination: string };
type Settings = { payout: string; split: string; gross: boolean; taxPct: string; essentials: string; savings: string; trading: string; cards: Card[] };
const KEY = "jarvis-payout-split-v2";
const HISTORY = "jarvis-payout-split-history-v2";
const initial: Settings = {
  payout: "", split: "90", gross: false, taxPct: "25", essentials: "0", savings: "0", trading: "0",
  cards: [
    { id: "capital-platinum", name: "Capital One Platinum", balance: 2000, limit: 2000, apr: null, minimum: 0, destination: "Capital One" },
    { id: "capital-quicksilver", name: "Capital One Quicksilver", balance: 580.19, limit: null, apr: null, minimum: 0, destination: "Capital One" },
    { id: "rbfcu-world", name: "RBFCU World Card", balance: 622.43, limit: 600, apr: 18, minimum: 25, destination: "RBFCU" }
  ]
};
const dollars = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const c = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100);
const val = (v: string) => Math.max(0, Number(v) || 0);
const inputValid = (v: string) => v === "" || (/^\d+(\.\d{0,2})?$/.test(v) && Number(v) <= 1000000000);
const BANKS = [
  ["TAX RESERVE", "American Express HYSA — separate tax bucket"],
  ["ESSENTIALS + CARD MINIMUMS", "Bank of America Personal Checking"],
  ["EMERGENCY SAVINGS", "American Express HYSA"],
  ["EXTRA DEBT PAYDOWN", "Capital One / RBFCU"],
  ["TRADING CAPITAL", "Bank of America Business Checking"]
];
export default function PayoutSplitCalculator({ accounts }: { accounts: FinanceAccountState[] }) {
  const [state, setState] = useState<Settings>(initial);
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState<{ date: string; net: number; tax: number; essentials: number; savings: number; debt: number; trading: number }[]>([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (saved && typeof saved === "object") {
        setState({ ...initial, ...saved, cards: initial.cards.map(card => ({ ...card, ...(Array.isArray(saved.cards) ? saved.cards.find((x: Card) => x.id === card.id) : {}) })) });
      }
      const prior = JSON.parse(localStorage.getItem(HISTORY) || "[]");
      if (Array.isArray(prior)) setHistory(prior.slice(0, 15));
    } catch { setNotice("Stored draft could not be loaded. Review inputs before saving."); }
  }, []);
  const update = (field: keyof Omit<Settings, "cards">, value: string | boolean) => { setState(p => ({ ...p, [field]: value })); setNotice(""); };
  const updateCard = (id: string, field: keyof Card, value: number | null) => setState(p => ({ ...p, cards: p.cards.map(card => card.id === id ? { ...card, [field]: value } : card) }));
  const calc = useMemo(() => {
    const gross = c(val(state.payout));
    const splitPct = Math.min(100, val(state.split));
    const net = state.gross ? Math.floor(gross * splitPct / 100) : gross;
    const taxPct = Math.min(100, val(state.taxPct));
    const tax = Math.floor(net * taxPct / 100);
    let available = net - tax;
    const essentials = Math.min(available, c(val(state.essentials))); available -= essentials;
    const savings = Math.min(available, c(val(state.savings))); available -= savings;
    const trading = Math.min(available, c(val(state.trading))); available -= trading;
    const desiredDebt = available;
    const cards = state.cards.map(card => ({ ...card, payment: 0 }));
    // All stated minimums are paid from the essentials bucket, never charged twice.
    // Extra debt is first allocated to bringing over-limit cards below their limits, then to known highest APR.
    const order = cards.map((card, i) => ({ card, i })).sort((a, b) => {
      const overA = a.card.limit != null && a.card.balance > a.card.limit ? 1 : 0;
      const overB = b.card.limit != null && b.card.balance > b.card.limit ? 1 : 0;
      if (overA !== overB) return overB - overA;
      return (b.card.apr ?? -1) - (a.card.apr ?? -1);
    });
    let unspent = desiredDebt;
    for (const item of order) {
      const card = item.card;
      if (unspent <= 0) break;
      const payment = Math.min(unspent, c(Math.max(0, card.balance - card.minimum)));
      cards[item.i].payment = payment / 100;
      unspent -= payment;
    }
    const debt = desiredDebt - unspent;
    return { net: net / 100, tax: tax / 100, essentials: essentials / 100, savings: savings / 100, trading: trading / 100, debt: debt / 100, unallocated: unspent / 100, cards,
      shortfall: Math.max(0, c(val(state.essentials)) + c(val(state.savings)) + c(val(state.trading)) - (net - tax)) / 100 };
  }, [state]);
  const invalid = ![state.payout, state.split, state.taxPct, state.essentials, state.savings, state.trading].every(inputValid)
    || val(state.split) > 100 || val(state.taxPct) > 100 || state.cards.some(card => [card.balance, card.minimum, card.apr ?? 0].some(n => !Number.isFinite(n) || n < 0));
  const save = () => {
    if (invalid || calc.net <= 0 || calc.shortfall > 0) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      const records = [{ date: new Date().toISOString(), net: calc.net, tax: calc.tax, essentials: calc.essentials, savings: calc.savings, debt: calc.debt, trading: calc.trading }, ...history].slice(0, 15);
      localStorage.setItem(HISTORY, JSON.stringify(records)); setHistory(records);
      setNotice("Scenario saved in this browser only. No bank transfers or card payments were executed.");
    } catch { setNotice("Could not save on this device. No transfers were made."); }
  };
  const bank = (pattern: RegExp) => accounts.find(a => a.type === "depository" && pattern.test(a.institution + " " + a.name));
  const personal = bank(/bank of america.*(financial ops|7224)/i);
  const business = bank(/bank of america.*(business|9024)/i);
  const savingsBank = bank(/american express.*(savings|4276)/i);
  return <section className={s.panel}>
    <div className={s.panelHead}><h3>PAYOUT SPLIT CALCULATOR</h3><span>LIVE CALCULATION · MANUAL EXECUTION</span></div>
    <p className={s.muted}>Set the next payout and obligations. Jarvis calculates an allocation proposal; nothing moves until you make and verify each transfer. Bank snapshots may be stale.</p>
    <div className={s.planner}>
      <div>
        <label>AMOUNT RECEIVED OR EXPECTED ($)<input type="number" min="0" step=".01" value={state.payout} onChange={e => update("payout", e.target.value)} placeholder="Enter payout" /></label>
        <label><input type="checkbox" checked={state.gross} onChange={e => update("gross", e.target.checked)} /> AMOUNT ABOVE IS GROSS BEFORE FIRM SPLIT</label>
        {state.gross && <label>YOUR PROP-FIRM SHARE (%)<input type="number" min="0" max="100" value={state.split} onChange={e => update("split", e.target.value)} /></label>}
        <div className={s.fields}>
          <label>TAX RESERVE (%)<input type="number" min="0" max="100" value={state.taxPct} onChange={e => update("taxPct", e.target.value)} /><small>Editable planning assumption, not tax advice</small></label>
          <label>BILLS + CARD MINIMUMS ($)<input type="number" min="0" step=".01" value={state.essentials} onChange={e => update("essentials", e.target.value)} /><small>Include gas, food, unpaid essentials and required card minimums</small></label>
          <label>EMERGENCY SAVINGS ($)<input type="number" min="0" step=".01" value={state.savings} onChange={e => update("savings", e.target.value)} /></label>
          <label>TRADING REINVESTMENT CAP ($)<input type="number" min="0" step=".01" value={state.trading} onChange={e => update("trading", e.target.value)} /><small>Only after taxes, essentials and savings</small></label>
        </div>
        <h4 style={{ marginTop: 16 }}>PERSONAL CARDS · EDIT CURRENT VALUES</h4>
        <p className={s.muted}>Reference balances can be outdated. Authorized-user RBFCU Platinum Premier is deliberately excluded. Confirm minimums and APRs before using the recommendation.</p>
        <div className={s.tableWrap}><table><thead><tr><th>CARD</th><th>BALANCE</th><th>APR %</th><th>MINIMUM</th></tr></thead><tbody>
          {state.cards.map(card => <tr key={card.id}><td>{card.name}</td><td><input aria-label={card.name + " balance"} type="number" min="0" step=".01" value={card.balance} onChange={e => updateCard(card.id, "balance", val(e.target.value))} /></td><td><input aria-label={card.name + " APR"} type="number" min="0" max="100" step=".01" value={card.apr ?? ""} placeholder="Unknown" onChange={e => updateCard(card.id, "apr", e.target.value === "" ? null : val(e.target.value))} /></td><td><input aria-label={card.name + " minimum"} type="number" min="0" step=".01" value={card.minimum} onChange={e => updateCard(card.id, "minimum", val(e.target.value))} /></td></tr>)}
        </tbody></table></div>
      </div>
      <aside className={s.planSummary} aria-live="polite">
        <span className={s.eyebrow}>DISTRIBUTION PREVIEW</span><strong>{dollars(calc.net)}</strong><p>NET PAYOUT TO ASSIGN</p>
        <dl>{[["Tax reserve",calc.tax],["Bills + minimums",calc.essentials],["Emergency savings",calc.savings],["Extra credit payoff",calc.debt],["Trading cap",calc.trading],["Unallocated",calc.unallocated]].map(([name,number])=><div key={name as string}><dt>{name}</dt><dd>{dollars(number as number)}</dd></div>)}</dl>
        {calc.shortfall > 0 && <p className={s.review}>Inputs exceed distributable funds by {dollars(calc.shortfall)}. Reduce allocations.</p>}
        {invalid && <p className={s.review}>Correct invalid amounts and percentages before saving.</p>}
        {calc.cards.map(card => <div key={card.id} style={{ borderTop: "1px solid rgba(255,255,255,.07)", padding: "7px 0" }}><small>{card.name} → {card.destination}</small><strong style={{ display: "block", fontSize: 14, margin: "3px 0" }}>{dollars(card.payment)}</strong><small>Projected balance: {dollars(Math.max(0,card.balance-card.payment))}</small></div>)}
        <button disabled={invalid || calc.net <= 0 || calc.shortfall > 0} onClick={save}>SAVE PAYOUT SCENARIO</button>
        <button onClick={() => { setState(initial); setNotice("Inputs reset; previously saved history remains on this device."); }}>RESET INPUTS</button>
        {notice && <p role="status">{notice}</p>}
      </aside>
    </div>
    <h4 style={{ marginTop: 18 }}>BANK DESTINATIONS</h4>
    <div className={s.tableWrap}><table><thead><tr><th>PURPOSE</th><th>DESTINATION</th><th>AMOUNT</th></tr></thead><tbody>
      {BANKS.map(([purpose,destination],i) => <tr key={purpose}><td>{purpose}</td><td>{destination}{i === 1 && personal ? " · " + personal.name : ""}{i === 4 && business ? " · " + business.name : ""}{(i === 0 || i === 2) && savingsBank ? " · " + savingsBank.name : ""}</td><td>{dollars([calc.tax,calc.essentials,calc.savings,calc.debt,calc.trading][i])}</td></tr>)}
    </tbody></table></div>
    <p className={s.muted}>Minimum card payments are included only in essentials; extra payoff excludes reserved minimums. The reserve percentage is provisional. No banking integration executes transfers.</p>
    {history.length > 0 && <div style={{ marginTop: 16 }}><h4>SAVED SCENARIOS ON THIS DEVICE</h4>{history.map((entry,i) => <p key={i}>{new Date(entry.date).toLocaleDateString("en-US")} · Net {dollars(entry.net)} · Taxes {dollars(entry.tax)} · Savings {dollars(entry.savings)} · Extra debt {dollars(entry.debt)}</p>)}</div>}
  </section>;
}
