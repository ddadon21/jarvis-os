"use client";

import { FlaskConical, Play, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import f from "./finance-capital.module.css";
import s from "./real-estate.module.css";

type Summary = {
  arrows: number; wins: number; losses: number; open: number; noTime: number;
  winRate: number | null; avgR: number | null; totalR: number; dayWinRate: number | null;
  daysWithArrows: number; daysWon: number; sessions: number; arrowsPerArrowDay: number | null; avgMinutesToTarget: number | null;
};
type ScoredArrow = { t: number; side: "LONG" | "SHORT"; entry: number; stop: number; target: number; result: string; r: number; minutesToExit: number | null };
type Run = { family: string; timeframeMinutes: number; source: string; message: string | null; result: { from: string | null; to: string | null; pathResolution: string; summary: Summary; arrows: ScoredArrow[] } | null };
type Coverage = Array<{ family: string; timeframes: Array<{ timeframe: string; bars: number; from: string | null; to: string | null }> }> | null;

const CHANGE_FIELDS = [
  ["minCandleBody", "Min candle body (pts)", 10],
  ["wickZone", "Wick zone (pts)", 80],
  ["levelStep", "Level spacing (pts)", 250],
  ["cciThreshold", "CCI threshold", 30],
  ["atrMult", "ATR multiplier", 0.8],
  ["hmaLookback", "HMA extreme lookback", 10],
  ["maxArrowsPerDay", "Max arrows / day", 3],
] as const;

const tf = (m: number | string) => { const n = Number(m); return n === 1 ? "1m" : n % 60 === 0 ? `${n / 60}h` : `${n}m`; };
const pct = (v: number | null) => v == null ? "—" : `${v.toFixed(1)}%`;
const num = (v: number | null, d = 2) => v == null ? "—" : v.toFixed(d);
const when = (t: number) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(t));
const delta = (a: number | null | undefined, b: number | null | undefined) => a == null || b == null ? "" : ` (${b - a >= 0 ? "+" : ""}${(b - a).toFixed(1)})`;

export default function ArrowBacktestPanel() {
  const [coverage, setCoverage] = useState<Coverage>(null);
  const [days, setDays] = useState(365);
  const [changes, setChanges] = useState<Record<string, string>>({});
  const [baseline, setBaseline] = useState<Run[] | null>(null);
  const [candidate, setCandidate] = useState<Run[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState(0);
  const [importSymbol, setImportSymbol] = useState("NQ");

  async function loadCoverage() {
    try {
      const response = await fetch("/api/trading/backtest", { cache: "no-store" });
      const body = await response.json();
      setCoverage(body.coverage ?? null);
    } catch { setCoverage(null); }
  }
  useEffect(() => { void loadCoverage(); }, []);

  const changed = Object.fromEntries(Object.entries(changes).filter(([, v]) => v.trim() !== "" && Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)]));
  const hasChanges = Object.keys(changed).length > 0;

  async function run() {
    setBusy(true); setStatus("Running backtest…"); setCandidate(null);
    try {
      const post = (body: object) => fetch("/api/trading/backtest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
      const base = await post({ days, label: "DEVIANT v1 baseline" });
      if (!base.ok) { setStatus(base.error ?? "Backtest unavailable."); setBaseline(null); return; }
      setBaseline(base.runs);
      if (hasChanges) {
        const cand = await post({ days, params: changed, label: "manual change" });
        if (cand.ok) setCandidate(cand.runs);
      }
      setStatus("");
    } catch { setStatus("Backtest request failed."); }
    finally { setBusy(false); }
  }

  async function importCsv(file: File | undefined) {
    if (!file) return;
    setStatus(`Importing ${file.name}…`);
    try {
      const response = await fetch(`/api/trading/bars/import?symbol=${encodeURIComponent(importSymbol)}`, { method: "POST", body: await file.text() });
      const body = await response.json();
      setStatus(body.ok ? `Imported ${body.written} ${body.family} ${tf(body.timeframeMinutes)} bars (${body.from?.slice(0, 10)} → ${body.to?.slice(0, 10)}).` : body.error ?? "Import failed.");
      if (body.ok) void loadCoverage();
    } catch { setStatus("Import failed."); }
  }

  const runs = baseline ?? [];
  const pick = runs[selected]?.result;

  return <section className={f.finance} aria-label="Arrow backtest">
    <section className={f.panel}>
      <div className={f.panelHead}><h3><FlaskConical size={13} />ARROW BACKTEST · DEVIANT v1</h3><span>NQ · YM · 30M · 2H · 3H · 4H</span></div>
      <p className={s.muted}>An arrow <b>wins</b> when price reaches the opposite bank level before the arrow candle&apos;s wick, inside that New York session. A <b>day is won</b> when one of its first 2 arrows wins. The baseline indicator is never edited; changes are tested side by side.</p>

      <div className={s.section} style={{ marginTop: 12 }}>HISTORY</div>
      {coverage == null ? <p className={s.muted}>Stored history unavailable (database not connected on this deployment).</p> : <div className={s.checks}>
        {coverage.map((c) => <div key={c.family} className={`${s.check} ${c.timeframes.length ? s.pass : s.unknown}`}><b>{c.family}</b><span>{c.timeframes.length ? c.timeframes.map((t) => `${tf(t.timeframe)} ${t.bars.toLocaleString("en-US")} bars from ${t.from?.slice(0, 10)}`).join(" · ") : "No history yet"}</span></div>)}
      </div>}
      <div className={f.actionRow}>
        <select aria-label="Symbol to import" value={importSymbol} onChange={(e) => setImportSymbol(e.target.value)} style={{ width: "auto" }}><option value="NQ">NQ / MNQ</option><option value="YM">YM / MYM</option></select>
        <label className={s.importButton}><Upload size={12} />IMPORT TRADINGVIEW CSV<input type="file" accept=".csv,text/csv" onChange={(e) => { void importCsv(e.target.files?.[0]); e.target.value = ""; }} hidden /></label>
      </div>
      <p className={s.muted} style={{ marginTop: 6 }}>TradingView → chart on 30m, 2h, 3h or 4h → Export chart data. 1-minute exports also work and make outcomes exact to the minute.</p>

      <div className={s.section} style={{ marginTop: 12 }}>TEST A CHANGE (OPTIONAL)</div>
      <div className={s.fields3}>{CHANGE_FIELDS.map(([key, label, base]) => <label key={key}>{label}<input type="number" step="any" inputMode="decimal" value={changes[key] ?? ""} placeholder={`baseline ${base}`} onChange={(e) => setChanges((c) => ({ ...c, [key]: e.target.value }))} /></label>)}</div>
      <div className={f.actionRow}>
        <select aria-label="History length" value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: "auto" }}>{[90, 180, 365, 730].map((d) => <option key={d} value={d}>Last {d} days</option>)}</select>
        <button onClick={() => void run()} disabled={busy}><Play size={12} />{busy ? "RUNNING…" : hasChanges ? "RUN BASELINE VS CHANGE" : "RUN BACKTEST"}</button>
        {hasChanges && <button onClick={() => setChanges({})}>CLEAR CHANGES</button>}
      </div>
      {status && <p role="status" style={{ marginTop: 10 }}>{status}</p>}
    </section>

    {runs.length > 0 && <section className={f.panel}>
      <div className={f.panelHead}><h3>RESULTS</h3><span>{candidate ? "BASELINE (CHANGE)" : "BASELINE"}</span></div>
      <div className={f.tableWrap}><table>
        <thead><tr><th>MARKET</th><th>DAY WIN %</th><th>ARROW WIN %</th><th>ARROWS</th><th>AVG R</th><th>TOTAL R</th><th>ARROWS / DAY</th><th>DATA</th></tr></thead>
        <tbody>{runs.map((run, i) => {
          const b = run.result?.summary; const c = candidate?.[i]?.result?.summary;
          return <tr key={`${run.family}-${run.timeframeMinutes}`} onClick={() => setSelected(i)} style={{ cursor: "pointer", background: i === selected ? "rgba(183,31,38,.08)" : undefined }}>
            <td><strong>{run.family} {tf(run.timeframeMinutes)}</strong><small>{run.result ? `${run.result.from?.slice(0, 10)} → ${run.result.to?.slice(0, 10)}` : ""}</small></td>
            {b ? <>
              <td>{pct(b.dayWinRate)}{c && <small>{pct(c.dayWinRate)}{delta(b.dayWinRate, c.dayWinRate)}</small>}<small>{b.daysWon}/{b.daysWithArrows} days</small></td>
              <td>{pct(b.winRate)}{c && <small>{pct(c.winRate)}{delta(b.winRate, c.winRate)}</small>}<small>{b.wins}W {b.losses}L {b.open}O</small></td>
              <td>{b.arrows}{c && <small>{c.arrows}</small>}{b.noTime > 0 && <small>{b.noTime} after session</small>}</td>
              <td className={b.avgR != null && b.avgR < 0 ? s.negative : ""}>{num(b.avgR)}{c && <small>{num(c.avgR)}</small>}</td>
              <td>{num(b.totalR, 1)}{c && <small>{num(c.totalR, 1)}</small>}</td>
              <td>{num(b.arrowsPerArrowDay, 1)}</td>
              <td><small>{run.source === "native" ? "Chart export" : "From 1m"} · paths {run.result!.pathResolution}</small></td>
            </> : <td colSpan={7}><small>{run.message}</small></td>}
          </tr>;
        })}</tbody>
      </table></div>
    </section>}

    {pick && pick.arrows.length > 0 && <section className={f.panel}>
      <div className={f.panelHead}><h3>RECENT ARROWS · {runs[selected].family} {tf(runs[selected].timeframeMinutes)}</h3><span>NEW YORK TIME</span></div>
      <div className={f.tableWrap}><table>
        <thead><tr><th>ARROW</th><th>ENTRY</th><th>STOP</th><th>TARGET</th><th>RESULT</th><th>R</th></tr></thead>
        <tbody>{[...pick.arrows].reverse().slice(0, 25).map((a) => <tr key={`${a.t}-${a.side}`}>
          <td><strong>{a.side}</strong><small>{when(a.t)}</small></td>
          <td>{a.entry.toFixed(2)}</td><td>{a.stop.toFixed(2)}</td><td>{a.target.toFixed(2)}</td>
          <td><span className={`${s.badge} ${a.result === "WIN" ? s.badgePASS : a.result === "LOSS" ? s.badgeFAIL : s.badgeUNKNOWN}`}>{a.result === "NO_TIME" ? "AFTER SESSION" : a.result}</span>{a.minutesToExit != null && <small>{a.minutesToExit} min</small>}</td>
          <td className={a.r < 0 ? s.negative : ""}>{a.r.toFixed(2)}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}
  </section>;
}
