"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useState } from "react";
import { FEATURES } from "../../lib/learning/features.ts";
import styles from "./learning.module.css";

type SideMetrics = { entries: number; signals: number; matched: number; recall: number; precision: number; signalsPerDay: number; avgR: number | null };
type Metrics = { days: number; long: SideMetrics; short: SideMetrics; combined: { recall: number; precision: number; signalsPerDay: number; avgR: number | null; totalR: number | null } } | null;
type Rule = { side: "LONG" | "SHORT"; conditions: Array<{ feature: string; op: "<=" | ">"; value: number }>; trainPrecision: number; trainSupport: number };
type Run = {
  id: string;
  createdAt: string;
  status: "CANDIDATE" | "SHADOW" | "PROMOTED" | "REJECTED";
  family: string;
  outcome: "COLLECT_MORE" | "CANDIDATE" | "NO_EDGE";
  message: string;
  verdict: string[];
  data: { entries: number; sessions: number; risk: { stopAtr: number; targetR: number; samples: number }; window: { startMinute: number; endMinute: number } } | null;
  rules: Rule[];
  metrics: { train: Metrics; test: Metrics; baselineTest: Metrics; dwightTest: Metrics };
  hasPine: boolean;
};
type Status = {
  ok: boolean;
  configured: boolean;
  error?: string;
  webhookConfigured?: boolean;
  coverage?: Array<{ family: string; bars: number; from: string | null; to: string | null }>;
  trades?: { total: number; byFamily: Record<string, number>; withPrepTime: number; withInitialStop: number };
  runs?: Run[];
};

const LABELS = Object.fromEntries(FEATURES.map((f) => [f.name, f.label]));
const FIRST_CANDIDATE = 40;

function pct(v: number | undefined | null) { return v == null ? "—" : Math.round(v * 100) + "%"; }
function r(v: number | null | undefined) { return v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(2) + "R"; }
function minuteLabel(m: number) { const h = Math.floor(m / 60); const mm = String(m % 60).padStart(2, "0"); return `${h}:${mm}`; }
function day(value: string | null) { return value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" }) : "—"; }

function describeCondition(c: Rule["conditions"][number]) {
  const label = LABELS[c.feature] ?? c.feature;
  if (c.feature === "ny_minute") return `${label} ${c.op === "<=" ? "at or before" : "after"} ${minuteLabel(Math.round(c.value))}`;
  if (c.feature.endsWith("_bars")) {
    const event = label.replace(/^Bars since (a )?/i, "");
    if (c.op === "<=") return c.value < 1 ? `${event} on this bar` : `${event} within the last ${Math.floor(c.value)} bars`;
    return `no ${event} in the last ${Math.floor(c.value)} bars`;
  }
  const spec = FEATURES.find((f) => f.name === c.feature);
  if (spec?.flag) return c.op === ">" ? label : `not: ${label}`;
  return `${label} ${c.op === "<=" ? "≤" : ">"} ${Number(c.value.toPrecision(3))}`;
}

export default function LearningLab() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [symbol, setSymbol] = useState("NQ1!");

  async function load() {
    const response = await fetch("/api/learning/status", { cache: "no-store" });
    setStatus(await response.json().catch(() => ({ ok: false, configured: false, error: "Status unavailable." })));
  }
  useEffect(() => { void load(); }, []);

  async function run() {
    setBusy("run");
    setNotice("Training on your journaled entries… this can take a minute.");
    try {
      const response = await fetch("/api/learning/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await response.json();
      setNotice(response.ok ? body.report.message : body.error);
      await load();
    } finally { setBusy(null); }
  }

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy("import");
    setNotice(`Importing ${file.name}…`);
    try {
      const response = await fetch(`/api/trading/bars/import?symbol=${encodeURIComponent(symbol)}`, { method: "POST", headers: { "Content-Type": "text/csv" }, body: await file.text() });
      const body = await response.json();
      setNotice(response.ok ? `Imported ${body.written.toLocaleString()} ${body.family} bars (${day(body.from)} → ${day(body.to)}).` : body.error);
      await load();
    } finally { setBusy(null); }
  }

  async function setModel(id: string, next: Run["status"]) {
    setBusy(id);
    try {
      const response = await fetch(`/api/learning/models/${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) });
      const body = await response.json();
      setNotice(response.ok ? `${id} → ${next}` : body.error);
      await load();
    } finally { setBusy(null); }
  }

  const trades = status?.trades;
  const coverage = status?.coverage ?? [];
  const runs = status?.runs ?? [];
  const latest = runs[0] ?? null;
  const shadow = runs.find((item) => item.status === "SHADOW") ?? null;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span>JARVIS // TRADING</span>
          <h1>LEARNING LAB</h1>
          <p>Observer entries + market bars → rules that place arrows the way you do. Every candidate is a new versioned indicator; DEVIANT v1 is never changed.</p>
        </div>
        <nav>
          <Link href="/workforce">AGENTS FLOOR</Link>
          <Link href="/work">JARVIS CORE</Link>
        </nav>
      </header>

      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
      {status && !status.configured ? <div className={styles.warn}>{status.error} Then apply the Supabase migrations and reload.</div> : null}

      <section className={styles.grid}>
        <article className={styles.card}>
          <h2>1 · Your entries</h2>
          <strong className={styles.big}>{trades?.total ?? 0}</strong>
          <small>journaled trades · {trades?.withPrepTime ?? 0} with prep time · {trades?.withInitialStop ?? 0} with an initial stop</small>
          <div className={styles.progress}><i style={{ width: Math.min(100, ((trades?.total ?? 0) / FIRST_CANDIDATE) * 100) + "%" }} /></div>
          <small>{FIRST_CANDIDATE} entries unlock the first candidate. More entries → more trustworthy rules.</small>
        </article>

        <article className={styles.card}>
          <h2>2 · Market bars</h2>
          {coverage.length ? coverage.map((c) => (
            <div key={c.family} className={styles.row}><b>{c.family}</b><span>{c.bars.toLocaleString()} bars · {day(c.from)} → {day(c.to)}</span></div>
          )) : <small>No 1-minute bars yet.</small>}
          <div className={styles.inline}>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Symbol for CSV import" />
            <label className={styles.button}>
              {busy === "import" ? "IMPORTING…" : "IMPORT TRADINGVIEW CSV"}
              <input type="file" accept=".csv,text/csv" onChange={importCsv} disabled={busy !== null} hidden />
            </label>
          </div>
          <small>Live feed: {status?.webhookConfigured ? "webhook secret set — add trading/indicators/jarvis-bar-feed.pine to a 1-minute chart with an alert." : "set JARVIS_MARKET_WEBHOOK_SECRET in Vercel first."}</small>
        </article>

        <article className={styles.card}>
          <h2>3 · Train</h2>
          <p className={styles.copy}>Trains on older sessions, tests on the newest ones it never saw, and compares against DEVIANT v1 and your own entries using your typical stop and target.</p>
          <button className={styles.button} onClick={run} disabled={busy !== null}>{busy === "run" ? "TRAINING…" : "RUN LEARNING NOW"}</button>
          <small>Runs automatically every weekday after the close.</small>
        </article>

        <article className={styles.card}>
          <h2>4 · Shadow → trust</h2>
          {shadow ? (
            <>
              <div className={styles.row}><b>SHADOW</b><span>{shadow.id}</span></div>
              <small>Jarvis replays it daily against your real trades. Add its Pine to a chart (arrows only) and compare.</small>
            </>
          ) : <small>No model in shadow mode. Put a candidate in shadow before ever relying on it.</small>}
          <small className={styles.hard}>Live order placement stays disabled. An EA comes only after months of shadow results beat your own entries.</small>
        </article>
      </section>

      {latest ? (
        <section className={styles.report}>
          <div className={styles.reportHead}>
            <div><span>LATEST RUN · {new Date(latest.createdAt).toLocaleString()}</span><h2>{latest.family} · {latest.outcome.replace("_", " ")}</h2></div>
            <b className={styles["status_" + latest.status]}>{latest.status}</b>
          </div>
          <p className={styles.copy}>{latest.message}</p>
          {latest.metrics.test || latest.metrics.baselineTest ? (
            <table className={styles.table}>
              <thead><tr><th>Unseen days</th><th>Your entries caught</th><th>Arrows that matched you</th><th>Arrows / day</th><th>Avg outcome</th></tr></thead>
              <tbody>
                <tr><td>Candidate</td><td>{pct(latest.metrics.test?.combined.recall)}</td><td>{pct(latest.metrics.test?.combined.precision)}</td><td>{latest.metrics.test?.combined.signalsPerDay.toFixed(2) ?? "—"}</td><td>{r(latest.metrics.test?.combined.avgR)}</td></tr>
                <tr><td>DEVIANT v1</td><td>{pct(latest.metrics.baselineTest?.combined.recall)}</td><td>{pct(latest.metrics.baselineTest?.combined.precision)}</td><td>{latest.metrics.baselineTest?.combined.signalsPerDay.toFixed(2) ?? "—"}</td><td>{r(latest.metrics.baselineTest?.combined.avgR)}</td></tr>
                <tr><td>You</td><td>100%</td><td>100%</td><td>{latest.metrics.dwightTest?.combined.signalsPerDay.toFixed(2) ?? "—"}</td><td>{r(latest.metrics.dwightTest?.combined.avgR)}</td></tr>
              </tbody>
            </table>
          ) : null}
          {latest.data ? <small>{latest.data.entries} entries · {latest.data.sessions} sessions · window {minuteLabel(latest.data.window.startMinute)}–{minuteLabel(latest.data.window.endMinute)} NY · your typical stop {latest.data.risk.stopAtr.toFixed(2)}× ATR, target {latest.data.risk.targetR.toFixed(2)}R ({latest.data.risk.samples} trades)</small> : null}
          {latest.rules.length ? (
            <div className={styles.rules}>
              {latest.rules.map((rule, index) => (
                <div key={index} className={styles.rule}>
                  <b className={rule.side === "LONG" ? styles.long : styles.short}>{rule.side === "LONG" ? "BUY ▲" : "SELL ▼"}</b>
                  <ul>{rule.conditions.map((c, k) => <li key={k}>{describeCondition(c)}</li>)}</ul>
                  <small>train precision {pct(rule.trainPrecision)} · {rule.trainSupport} matches</small>
                </div>
              ))}
            </div>
          ) : null}
          <ul className={styles.verdict}>{latest.verdict.map((line) => <li key={line}>{line}</li>)}</ul>
          <div className={styles.actions}>
            {latest.hasPine ? <a className={styles.button} href={`/api/learning/models/${encodeURIComponent(latest.id)}`}>DOWNLOAD PINE</a> : null}
            {latest.status === "CANDIDATE" ? <button className={styles.button} disabled={busy !== null} onClick={() => setModel(latest.id, "SHADOW")}>PUT IN SHADOW MODE</button> : null}
            {latest.status !== "REJECTED" ? <button className={styles.ghost} disabled={busy !== null} onClick={() => setModel(latest.id, "REJECTED")}>REJECT</button> : null}
          </div>
        </section>
      ) : null}

      {runs.length > 1 ? (
        <section className={styles.history}>
          <h2>Run history</h2>
          {runs.slice(1).map((item) => (
            <div key={item.id} className={styles.row}>
              <b className={styles["status_" + item.status]}>{item.status}</b>
              <span>{new Date(item.createdAt).toLocaleDateString()} · {item.family} · {item.outcome} · caught {pct(item.metrics.test?.combined.recall)} vs v1 {pct(item.metrics.baselineTest?.combined.recall)}</span>
              {item.hasPine ? <a href={`/api/learning/models/${encodeURIComponent(item.id)}`}>PINE</a> : null}
            </div>
          ))}
        </section>
      ) : null}
    </main>
  );
}
