"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./lifetime-earned.module.css";
import type { LifetimeEarned } from "../lib/company-earnings";

const REFRESH_MS = 5 * 60_000;

export function useLifetimeEarned() {
  const [earned, setEarned] = useState<LifetimeEarned | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/company/earnings", { cache: "no-store" });
        const payload = await response.json() as { ok?: boolean; earned?: LifetimeEarned };
        if (cancelled) return;
        if (response.ok && payload.earned) { setEarned(payload.earned); setFailed(false); } else setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  return { earned, failed };
}

function dateLabel(value: string | null) {
  if (!value) return "date not recorded";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Compact header stat (LIFETIME EARNED, rounded to one-decimal thousands) with exact amount and sources on drill-in. */
export function LifetimeEarnedStat() {
  const { earned, failed } = useLifetimeEarned();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  const value = earned?.total == null ? (failed || earned ? "UNAVAILABLE" : "…") : earned.display;
  const title = earned?.total == null
    ? "Lifetime earned: source unavailable"
    : `Lifetime earned ${earned.exact} · ${earned.counted.length} verified records · coverage ${earned.coverage}`;

  return (
    <div className={styles.wrap} ref={ref}>
      <button type="button" className={styles.stat} title={title} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>LIFETIME EARNED</span>
        <b>{value}</b>
        {earned && earned.coverage !== "COMPLETE" ? <em>{earned.coverage}</em> : null}
      </button>
      {open ? (
        <div className={styles.panel} role="dialog" aria-label="Lifetime earned detail">
          <strong>{earned?.exact ?? "—"}</strong>
          <p>{earned?.definition ?? "Verified historical money produced. Not current cash, not net worth."}</p>
          {earned?.counted.length ? (
            <ul>
              {earned.counted.map((record) => (
                <li key={record.source + record.id}>
                  <span>{record.counterparty ?? "Unknown payer"} · {dateLabel(record.occurredAt)}</span>
                  <b>{record.amount.toLocaleString("en-US", { style: "currency", currency: "USD" })}</b>
                  <small>{record.evidence}</small>
                </li>
              ))}
            </ul>
          ) : <p>No verified records counted.</p>}
          <div className={styles.sources}>
            {(earned?.sources ?? []).map((source) => (
              <div key={source.source}>
                <span>{source.label}</span>
                <b>{source.status === "CONNECTED" ? `${source.count} · ${source.total.toLocaleString("en-US", { style: "currency", currency: "USD" })}` : source.status.replace("_", " ")}</b>
                {source.note ? <small>{source.note}</small> : null}
              </div>
            ))}
          </div>
          {earned ? (
            <small className={styles.foot}>
              Excluded: {earned.excluded.unsettled} not paid · {earned.excluded.transfers} transfers · {earned.excluded.duplicates} duplicates · as of {new Date(earned.asOf).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </small>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
