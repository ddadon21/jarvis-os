"use client";

import { Bot, Calculator, Home, ListFilter, MapPin, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  DEAL_STAGES, EMPTY_CRITERIA, EMPTY_DEAL, PROPERTY_TYPES, analyzeDeal, checkCriteria, criteriaSetCount, num, verdict,
  type DealCriteria, type DealInput, type DealStage, type PropertyType, type SavedDeal,
} from "../lib/real-estate-math";
import f from "./finance-capital.module.css";
import s from "./real-estate.module.css";

const CRITERIA_KEY = "jarvis-real-estate-criteria-v1";
const DEALS_KEY = "jarvis-real-estate-deals-v1";
type View = "DEAL PIPELINE" | "CRITERIA" | "DEAL ANALYZER";

const money = (v: number | null) => v == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
const pct = (v: number | null) => v == null ? "—" : `${v.toFixed(1)}%`;

function load<T>(key: string, fallback: T, valid: (v: unknown) => v is T): T {
  try { const raw = JSON.parse(localStorage.getItem(key) ?? "null"); return valid(raw) ? raw : fallback; } catch { return fallback; }
}
function store(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCriteria = (v: unknown): v is DealCriteria => isObject(v) && typeof v.areas === "string" && Array.isArray(v.propertyTypes);
const isDeals = (v: unknown): v is SavedDeal[] => Array.isArray(v) && v.every(d => isObject(d) && typeof d.id === "string");

export default function RealEstateDeals() {
  const [view, setView] = useState<View>("DEAL PIPELINE");
  const [criteria, setCriteria] = useState<DealCriteria>(EMPTY_CRITERIA);
  const [deals, setDeals] = useState<SavedDeal[]>([]);
  const [deal, setDeal] = useState<DealInput>(EMPTY_DEAL);
  const [status, setStatus] = useState("");

  useEffect(() => {
    setCriteria({ ...EMPTY_CRITERIA, ...load(CRITERIA_KEY, EMPTY_CRITERIA, isCriteria) });
    setDeals(load(DEALS_KEY, [], isDeals));
  }, []);

  const maxArv = num(criteria.maxArvPercent);
  const areas = criteria.areas.split(/[,\n;]/).map(a => a.trim()).filter(Boolean);
  const setCount = criteriaSetCount(criteria);
  const scored = useMemo(() => deals.map(d => {
    const result = analyzeDeal(d, maxArv);
    return { deal: d, result, verdict: verdict(checkCriteria(d, criteria, result)) };
  }), [deals, criteria, maxArv]);
  const passing = scored.filter(x => x.verdict === "PASS" && x.deal.stage !== "PASSED").length;
  const result = analyzeDeal(deal, maxArv);
  const checks = checkCriteria(deal, criteria, result);
  const dealVerdict = verdict(checks);

  const updateCriteria = <K extends keyof DealCriteria>(key: K, value: DealCriteria[K]) => { setCriteria(c => ({ ...c, [key]: value })); setStatus(""); };
  const toggleType = (t: PropertyType) => updateCriteria("propertyTypes", criteria.propertyTypes.includes(t) ? criteria.propertyTypes.filter(x => x !== t) : [...criteria.propertyTypes, t]);
  const updateDeal = (key: keyof DealInput, value: string) => { setDeal(d => ({ ...d, [key]: value })); setStatus(""); };
  const saveDeals = (next: SavedDeal[]) => { setDeals(next); store(DEALS_KEY, next); };

  function saveCriteria() {
    setStatus(store(CRITERIA_KEY, criteria) ? "Criteria saved on this browser." : "Storage unavailable. Criteria are not saved.");
  }
  function addToPipeline() {
    if (!deal.address.trim()) { setStatus("Enter an address before saving the deal."); return; }
    const saved: SavedDeal = { ...deal, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, stage: "NEW", savedAt: new Date().toISOString() };
    saveDeals([saved, ...deals]);
    setDeal(EMPTY_DEAL);
    setStatus("");
    setView("DEAL PIPELINE");
  }

  const numberField = (label: string, key: keyof DealInput, placeholder = "", hint?: string) => (
    <label>{label}<input type="number" inputMode="decimal" min="0" step="any" value={deal[key]} onChange={e => updateDeal(key, e.target.value)} placeholder={placeholder} />{hint && <small>{hint}</small>}</label>
  );
  const criteriaField = (label: string, key: keyof DealCriteria, placeholder = "", hint?: string) => (
    <label>{label}<input type="number" inputMode="decimal" min="0" step="any" value={criteria[key] as string} onChange={e => updateCriteria(key, e.target.value as never)} placeholder={placeholder} />{hint && <small>{hint}</small>}</label>
  );

  return <section className={f.finance} aria-label="Real estate fix and flip deals">
    <header className={f.header}>
      <div><span className={f.eyebrow}>REAL ESTATE</span><h2>FIX &amp; FLIP DEAL FINDER</h2><p>Find the best flips in your target areas, scored against your criteria.</p></div>
      <div className={f.sync}><span><i />DEAL AGENT · NOT BUILT YET</span><small>Deals are entered by hand for now</small></div>
    </header>

    <div className={f.metrics}>
      <Metric label="TARGET AREAS" value={String(areas.length)} note={areas.length ? areas.slice(0, 3).join(" · ") + (areas.length > 3 ? " …" : "") : "None set yet"} accent />
      <Metric label="CRITERIA SET" value={String(setCount)} note={setCount ? "Rules every deal is checked against" : "Waiting on your criteria"} />
      <Metric label="DEALS IN PIPELINE" value={String(deals.filter(d => d.stage !== "PASSED").length)} note={`${deals.filter(d => d.stage === "PASSED").length} passed on`} />
      <Metric label="MEETING CRITERIA" value={String(passing)} note="Every set rule passes" />
    </div>

    <nav className={f.tabs} aria-label="Real estate views">{(["DEAL PIPELINE", "CRITERIA", "DEAL ANALYZER"] as View[]).map(t => <button key={t} aria-current={view === t ? "page" : undefined} onClick={() => setView(t)}>{t}</button>)}</nav>

    {view === "DEAL PIPELINE" && <section className={f.panel}>
      <div className={f.panelHead}><h3><Home size={13} />DEAL PIPELINE</h3><span>RANKED BY PROFIT</span></div>
      {deals.length === 0 ? <div className={s.empty}>
        <strong>NO DEALS YET</strong>
        <p className={s.muted}>{setCount ? "Run a property through the analyzer to add it here. Once the deal agent is built, it will fill this list with properties that match your criteria." : "Start by locking in your criteria. Then the deal agent will search your target areas and fill this list with matching fix-and-flip deals."}</p>
        <div className={f.actionRow} style={{ justifyContent: "center" }}>
          <button onClick={() => setView("CRITERIA")}><ListFilter size={12} />SET CRITERIA</button>
          <button onClick={() => setView("DEAL ANALYZER")}><Calculator size={12} />ANALYZE A DEAL</button>
        </div>
      </div> : <div className={f.tableWrap}><table>
        <thead><tr><th>PROPERTY</th><th>PRICE / ARV</th><th>REHAB</th><th>PROFIT / ROI</th><th>MAX OFFER</th><th>CRITERIA</th><th>STAGE</th></tr></thead>
        <tbody>{[...scored].sort((a, b) => b.result.profit - a.result.profit).map(({ deal: d, result: r, verdict: v }) => <tr key={d.id}>
          <td><strong>{d.address}</strong><small>{[d.area, d.propertyType, d.beds && `${d.beds} bd`, d.baths && `${d.baths} ba`, d.sqft && `${Number(d.sqft).toLocaleString("en-US")} sqft`].filter(Boolean).join(" · ") || "No details"}</small></td>
          <td>{money(num(d.purchasePrice))}<small>ARV {money(num(d.arv))}</small></td>
          <td>{money(num(d.rehab))}</td>
          <td className={r.profit < 0 ? s.negative : ""}>{r.ready ? money(r.profit) : "—"}<small>{r.ready ? `${pct(r.roi)} ROI` : `Missing ${r.missing.join(", ")}`}</small></td>
          <td>{money(r.maxOffer)}<small>{maxArv == null ? "Set max % of ARV" : `${maxArv}% rule`}</small></td>
          <td><span className={`${s.badge} ${s[`badge${v}`] ?? ""}`}>{v}</span></td>
          <td><div className={s.rowActions}>
            <select aria-label={`Stage for ${d.address}`} value={d.stage} onChange={e => saveDeals(deals.map(x => x.id === d.id ? { ...x, stage: e.target.value as DealStage } : x))}>{DEAL_STAGES.map(st => <option key={st}>{st}</option>)}</select>
            <button aria-label={`Delete ${d.address}`} onClick={() => saveDeals(deals.filter(x => x.id !== d.id))}><Trash2 size={11} /></button>
          </div></td>
        </tr>)}</tbody>
      </table></div>}
    </section>}

    {view === "CRITERIA" && <section className={f.panel}>
      <div className={f.panelHead}><h3><ListFilter size={13} />DEAL CRITERIA</h3><span>{setCount} SET · BLANK = NOT CHECKED</span></div>
      <p className={s.muted} style={{ marginBottom: 12 }}>Every deal is scored against these rules. Leave a field blank to skip it. The deal agent will use the same criteria to search.</p>
      <div className={s.section}>LOCATION</div>
      <label><span><MapPin size={10} /> TARGET AREAS</span><textarea className={s.textarea} value={criteria.areas} onChange={e => updateCriteria("areas", e.target.value)} placeholder="Cities, neighborhoods or ZIP codes, separated by commas" /></label>
      <div className={s.section}>PROPERTY</div>
      <div className={s.types} role="group" aria-label="Property types">{PROPERTY_TYPES.map(t => <button key={t} type="button" aria-pressed={criteria.propertyTypes.includes(t)} onClick={() => toggleType(t)}>{t}</button>)}</div>
      <div className={s.fields3}>
        {criteriaField("MIN PRICE ($)", "minPrice")}
        {criteriaField("MAX PRICE ($)", "maxPrice")}
        {criteriaField("MAX DAYS ON MARKET", "maxDaysOnMarket")}
        {criteriaField("MIN BEDS", "minBeds")}
        {criteriaField("MIN BATHS", "minBaths")}
        {criteriaField("MIN SQFT", "minSqft")}
        {criteriaField("BUILT AFTER (YEAR)", "minYearBuilt")}
      </div>
      <div className={s.section}>NUMBERS</div>
      <div className={s.fields3}>
        {criteriaField("MAX REHAB ($)", "maxRehab")}
        {criteriaField("MIN PROFIT ($)", "minProfit")}
        {criteriaField("MIN ROI (%)", "minRoi")}
        {criteriaField("MAX % OF ARV", "maxArvPercent", "e.g. 70", "Price + rehab as % of ARV (the 70% rule)")}
      </div>
      <label className={s.wide}>NOTES FOR THE DEAL AGENT<textarea className={s.textarea} value={criteria.notes} onChange={e => updateCriteria("notes", e.target.value)} placeholder="Anything else: avoid flood zones, no foundation issues, prefer distressed listings..." /></label>
      <div className={f.actionRow}><button onClick={saveCriteria}><Save size={12} />SAVE CRITERIA</button><button onClick={() => { setCriteria(EMPTY_CRITERIA); store(CRITERIA_KEY, EMPTY_CRITERIA); setStatus("Criteria cleared."); }}>CLEAR</button></div>
      {status && <p role="status" style={{ marginTop: 10 }}>{status}</p>}
    </section>}

    {view === "DEAL ANALYZER" && <section className={f.panel}>
      <div className={f.panelHead}><h3><Calculator size={13} />DEAL ANALYZER</h3><span>RUN THE NUMBERS</span></div>
      <div className={f.planner}>
        <div>
          <div className={s.section}>PROPERTY</div>
          <label>ADDRESS<input value={deal.address} onChange={e => updateDeal("address", e.target.value)} placeholder="123 Main St" /></label>
          <div className={f.fields}>
            <label>AREA<input value={deal.area} onChange={e => updateDeal("area", e.target.value)} placeholder="City or ZIP" /></label>
            <label>TYPE<select value={deal.propertyType} onChange={e => updateDeal("propertyType", e.target.value)}><option value="">Choose</option>{PROPERTY_TYPES.map(t => <option key={t}>{t}</option>)}</select></label>
          </div>
          <div className={s.fields3}>
            {numberField("BEDS", "beds")}{numberField("BATHS", "baths")}{numberField("SQFT", "sqft")}
            {numberField("YEAR BUILT", "yearBuilt")}{numberField("DAYS ON MARKET", "daysOnMarket")}
          </div>
          <div className={s.section}>NUMBERS</div>
          <div className={f.fields}>
            {numberField("PURCHASE PRICE ($)", "purchasePrice")}
            {numberField("ARV ($)", "arv", "", "After-repair value")}
            {numberField("REHAB ($)", "rehab")}
            {numberField("FINANCING COST ($)", "financingCost", "", "Points, fees, total interest")}
            {numberField("HOLDING (MONTHS)", "holdingMonths")}
            {numberField("HOLDING / MONTH ($)", "monthlyHolding", "", "Taxes, insurance, utilities")}
            {numberField("BUY CLOSING (%)", "buyClosingPercent", "2")}
            {numberField("SELL COSTS (%)", "sellCostPercent", "8", "Agent commissions + closing")}
          </div>
        </div>
        <aside className={f.planSummary} aria-live="polite">
          <span className={f.eyebrow}>ESTIMATED PROFIT</span>
          <strong className={result.ready && result.profit < 0 ? s.negative : ""}>{result.ready ? money(result.profit) : "—"}</strong>
          <p>{result.ready ? `${pct(result.roi)} ROI on cash in` : `Enter ${result.missing.join(", ")}`}</p>
          <dl>
            <div><dt>Cash in before sale</dt><dd>{money(result.ready ? result.cashInvested : null)}</dd></div>
            <div><dt>Buy closing</dt><dd>{money(result.buyClosing)}</dd></div>
            <div><dt>Holding</dt><dd>{money(result.holding)}</dd></div>
            <div><dt>Selling costs</dt><dd>{money(result.sellCosts)}</dd></div>
            <div><dt>Price + rehab as % of ARV</dt><dd>{pct(result.arvPercent)}</dd></div>
            <div><dt>Max offer{maxArv != null ? ` (${maxArv}% rule)` : ""}</dt><dd>{maxArv == null ? "Set in criteria" : money(result.maxOffer)}</dd></div>
          </dl>
          <span className={f.eyebrow}>CRITERIA · <span className={`${s.badge} ${s[`badge${dealVerdict}`] ?? ""}`}>{dealVerdict}</span></span>
          {checks.length ? <div className={s.checks}>{checks.map(c => <div key={c.label} className={`${s.check} ${c.pass === true ? s.pass : c.pass === false ? s.fail : s.unknown}`}><b>{c.label}</b><span>{c.detail}</span></div>)}</div>
            : <p className={s.muted} style={{ marginTop: 8 }}>No criteria set yet. Add them in the Criteria tab to score this deal.</p>}
          <button onClick={addToPipeline}><Save size={11} />ADD TO PIPELINE</button>
          <button onClick={() => { setDeal(EMPTY_DEAL); setStatus(""); }}>CLEAR</button>
          {status && <p role="status">{status}</p>}
        </aside>
      </div>
    </section>}

    <footer className={f.footer}><Bot size={12} /><span>Next: a deal agent that searches your target areas and fills the pipeline automatically. Saved on this browser for now.</span></footer>
  </section>;
}

function Metric({ label, value, note, accent = false }: { label: string; value: string; note: string; accent?: boolean }) {
  return <div className={accent ? f.metricAccent : ""}><span>{label}</span><b>{value}</b><small>{note}</small></div>;
}
