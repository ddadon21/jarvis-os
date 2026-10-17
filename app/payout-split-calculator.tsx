"use client";
import { useEffect, useMemo, useState } from "react";
import type { FinanceAccountState } from "../lib/jarvis-runtime";
import s from "./finance-capital.module.css";

const KEY = "jarvis-payout-automatic-v1";
const HISTORY = "jarvis-payout-automatic-history-v1";
const POLICY = [
  { key: "tax", name: "TAX RESERVE", pct: 25, destination: "American Express HYSA · earmarked for taxes" },
  { key: "essentials", name: "ESSENTIALS + MINIMUMS", pct: 25, destination: "BofA Personal Checking · gas, food, bills and card minimums" },
  { key: "savings", name: "EMERGENCY SAVINGS", pct: 20, destination: "American Express HYSA · emergency fund" },
  { key: "debt", name: "EXTRA CARD PAYOFF", pct: 30, destination: "Capital One / RBFCU · pay cards directly" },
  { key: "trading", name: "TRADING REINVESTMENT", pct: 0, destination: "BofA Business Checking · disabled until safety buffer is funded" }
] as const;
type Item = typeof POLICY[number]["key"];
type History = { at: string; net: number; allocation: Record<Item,number> };
const CARDS = [
  { key:"world", name:"RBFCU World Card", balance:622.43, apr:18, limit:600 },
  { key:"quicksilver", name:"Capital One Quicksilver", balance:580.19, apr:null, limit:null },
  { key:"platinum", name:"Capital One Platinum", balance:2000, apr:null, limit:2000 }
];
const money = (n:number) => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n);
export default function PayoutSplitCalculator({ accounts }: { accounts: FinanceAccountState[] }) {
 const [payout,setPayout] = useState("");
 const [history,setHistory] = useState<History[]>([]);
 const [message,setMessage] = useState("");
 useEffect(() => {
  try {
   const previous=localStorage.getItem(KEY);
   if(previous && /^\\d+(\\.\\d{0,2})?$/.test(previous)) setPayout(previous);
   const stored=JSON.parse(localStorage.getItem(HISTORY) || "[]");
   if(Array.isArray(stored)) setHistory(stored.slice(0,10));
  } catch { setMessage("Local history unavailable on this device."); }
 },[]);
 const invalid=payout!=="" && (!/^\\d+(\\.\\d{0,2})?$/.test(payout) || Number(payout)>1000000000);
 const net=invalid?0:Math.round((Number(payout)||0)*100);
 const allocation=useMemo(()=>{
  const map={} as Record<Item,number>;
  let assigned=0;
  POLICY.forEach((p,i)=>{
   const cents=i===POLICY.length-1?net-assigned:Math.floor(net*p.pct/100);
   map[p.key]=Math.max(0,cents); assigned+=map[p.key];
  });
  // Never conceal rounding residues as discretionary trading capital.
  const rounding=net-assigned;
  map.savings+=rounding;
  return map;
 },[net]);
 const cardPlan=useMemo(()=>{
  let remaining=allocation.debt;
  return CARDS.map(card=>{
   const paid=Math.min(remaining,Math.round(card.balance*100));
   remaining-=paid;
   return {...card,payment:paid,balanceAfter:Math.max(0,Math.round(card.balance*100)-paid)};
  });
 },[allocation.debt]);
 const knownCards=accounts.filter(a=>a.type==="credit" && a.ownership!=="AUTHORIZED_USER");
 const needsReview=knownCards.some(a=>/world|quicksilver/i.test(a.name));
 const save=()=>{
  if(invalid||net<=0)return;
  try{
   const entry={at:new Date().toISOString(),net,allocation};
   const next=[entry,...history].slice(0,10);
   localStorage.setItem(KEY,payout);
   localStorage.setItem(HISTORY,JSON.stringify(next));
   setHistory(next);
   setMessage("Allocation saved on this device. No transfers or payments were made.");
  }catch{setMessage("Browser storage unavailable; no payments were made.");}
 };
 return <section className={`${s.panel} ${s.splitCalculator}`}>
  <div className={s.panelHead}><h3>AUTOMATIC PAYOUT SPLIT</h3><span>ONE INPUT · FIVE ALLOCATIONS</span></div>
  <p className={s.muted}>Enter the net amount you actually receive <strong>after the prop-firm split</strong>. Jarvis applies the same conservative payout policy automatically. Estimates are not bank transfers or tax advice.</p>
  <div className={s.splitEntry}>
   <label>NET PAYOUT RECEIVED ($)<input aria-label="Net payout received" type="number" inputMode="decimal" min="0" step=".01" placeholder="e.g. 810.00" value={payout} onChange={e=>{setPayout(e.target.value);setMessage("");}} /></label>
   <div><small>AUTOMATIC DISTRIBUTION</small><strong>{money(net/100)}</strong></div>
  </div>
  {invalid && <p className={s.review}>Enter a valid nonnegative payout with no more than two decimal places.</p>}
  <div className={s.splitRoutes}>
   {POLICY.map(p=><div className={s.splitRoute} key={p.key}><div><strong>{p.name} · {p.pct}%</strong><small>{p.destination}</small></div><b>{money(allocation[p.key]/100)}</b></div>)}
  </div>
  <div className={s.splitPolicyNote}><strong>POLICY: 25% TAXES / 25% LIVING / 20% SAVINGS / 30% DEBT / 0% TRADING</strong><p>This is a provisional starting split, not a guarantee it covers every unpaid bill or tax obligation. Trading reinvestment stays at zero until cash stability improves. Review actual upcoming bills and taxes before acting.</p></div>
  <h4 style={{marginTop:14}}>CARD PAYOFF ORDER · EXTRA DEBT ALLOCATION</h4>
  <p className={s.muted}>Reference balances may be outdated. Payments below are <strong>extra payments</strong>; required minimums come from the essentials allocation. RBFCU Platinum Premier is excluded because it is an authorized-user card. Confirm current APRs and dues before paying.</p>
  <div className={s.splitRoutes}>{cardPlan.map(card=><div className={s.splitRoute} key={card.key}><div><strong>{card.name}</strong><small>Reference owed {money(card.balance)} · projected after extra payment {money(card.balanceAfter/100)}</small></div><b>{money(card.payment/100)}</b></div>)}</div>
  <p className={s.muted}>The order prioritizes getting the over-limit World Card down, then uses a provisional sequence until the two Capital One APRs are confirmed. Extra payments never exceed reference balances. Any debt allocation beyond those balances must be held, not spent.</p>
  {needsReview && <p className={s.muted}>Connected card snapshots are available elsewhere in Finance, but these reference amounts are not independently verified as current.</p>}
  <div className={s.splitActions}><button disabled={invalid||net<=0} onClick={save}>SAVE PAYOUT PLAN</button><button onClick={()=>{setPayout("");setMessage("");}}>CLEAR AMOUNT</button></div>
  {message && <p role="status">{message}</p>}
  {history.length>0 && <div className={s.splitHistory}><h4>RECENT SAVED SCENARIOS · THIS DEVICE</h4>{history.map((h,i)=><p key={h.at+i}>{new Date(h.at).toLocaleDateString("en-US")} · Payout {money(h.net/100)} · Savings {money(h.allocation.savings/100)} · Debt {money(h.allocation.debt/100)}</p>)}</div>}
 </section>;
}
