"use client";

import { Activity, Crosshair, Eye, Gauge, Radio, ShieldCheck, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type ObserverState = {
  status: "FLAT" | "PENDING" | "OPEN" | "UNKNOWN";
  symbol: string | null;
  side: "LONG" | "SHORT" | null;
  quantity: number | null;
  orderType: "LIMIT" | "STOP" | "MARKET" | null;
  entryPrice: number | null;
  currentPrice: number | null;
  stopPrice: number | null;
  targetPrice: number | null;
  openPnl: number | null;
  confidence: number;
  observedAt: string | null;
  evidence: string[];
};

type Trade = {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  quantity: number;
  status: "OPEN" | "CLOSED";
  entryPrice: number | null;
  exitPrice: number | null;
  stopPrice: number | null;
  targetPrice: number | null;
  openedAt: string;
  closedAt: string | null;
  realizedPnl: number | null;
};

type TradingState = {
  account: {
    provider: string;
    propFirm: string | null;
    accountLabel: string;
    connection: "DISCONNECTED" | "CONNECTING" | "OBSERVING" | "DEGRADED";
    stage: string;
    balance: number | null;
    equity: number | null;
    openPnl: number;
    closedPnl: number;
    lastObservedAt: string | null;
  };
  observer?: ObserverState;
  openTrades: Trade[];
  recentTrades: Trade[];
  today: {
    trades: number;
    wins: number;
    losses: number;
    realizedPnl: number;
  };
  note: string;
};

type ApiResponse = { state: TradingState; observing: boolean };

function money(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function number(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function age(iso: string | null | undefined) {
  if (!iso) return "NO LIVE OBSERVATION";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "UNKNOWN";
  if (ms < 5_000) return "JUST NOW";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}S AGO`;
  return `${Math.floor(ms / 60_000)}M AGO`;
}

export default function TradingCockpit() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState(false);
  const [mockWatching, setMockWatching] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("jarvis-observer-control-mock-v1");
    setMockWatching(saved === "watching");
  }, []);

  useEffect(() => {
    window.localStorage.setItem("jarvis-observer-control-mock-v1", mockWatching ? "watching" : "paused");
  }, [mockWatching]);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const response = await fetch("/api/trading/state", { cache: "no-store" });
        if (!response.ok) throw new Error("state unavailable");
        const next = (await response.json()) as ApiResponse;
        if (!cancelled) {
          setData(next);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }

    void refresh();
    const timer = window.setInterval(refresh, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const state = data?.state;
  const observer = state?.observer;
  const observing = data?.observing === true;
  const current = state?.openTrades[0];
  const status = observer?.status ?? (current ? "OPEN" : "UNKNOWN");
  const sampleCount = (state?.recentTrades.length ?? 0) + (state?.openTrades.length ?? 0);
  const confidence = Math.round((observer?.confidence ?? 0) * 100);

  const controlWatching = observing || mockWatching;
  const liveLabel = useMemo(() => {
    if (error) return "STATE ERROR";
    if (!observing && mockWatching) return "WATCH ARMED · MOCK CONTROL";
    if (!observing) return "LOCAL / NOT PAIRED";
    if (status === "PENDING") return "WATCHING PENDING ORDER";
    if (status === "OPEN") return "WATCHING LIVE POSITION";
    if (status === "FLAT") return "WATCHING · FLAT";
    return "WATCHING";
  }, [error, mockWatching, observing, status]);

  return (
    <section className="trading-cockpit">
      <div className="trading-hero">
        <div>
          <span className="trading-kicker"><Eye size={14} /> JARVIS TRADING OBSERVER</span>
          <h2>{liveLabel}</h2>
          <p>
            Learn Dwight&apos;s real entries first. DEVIANT stays aligned to the demonstrated strategy and is refined from evidence, not guesses. The red/white control is visual-only until desktop pairing is complete.
          </p>
        </div>
        <div className="observer-control-stack">
          <button
            type="button"
            className={`observer-record-control ${controlWatching ? "is-watching" : "is-paused"} ${observing ? "is-real" : "is-mock"}`}
            onClick={() => {
              if (!observing) setMockWatching((current) => !current);
            }}
            aria-pressed={controlWatching}
            aria-label={controlWatching ? "Pause observer" : "Start observer"}
            title={observing ? "Live observer control will be wired after desktop pairing" : "Mock control for the upcoming desktop observer link"}
          >
            <span className="observer-record-ring">
              <span className="observer-record-core" />
            </span>
            <span className="observer-control-copy">
              <small>{observing ? "OBSERVER CONTROL" : "MOCK CONTROL"}</small>
              <strong>{controlWatching ? "WATCHING" : "PAUSED"}</strong>
              <em>{observing ? "DESKTOP LINK LIVE" : "PAIRING PENDING"}</em>
            </span>
          </button>
          <div className={`trading-live-badge ${observing ? "is-live" : ""}`}>
            <Radio size={16} />
            <div>
              <span>OBSERVER LINK</span>
              <strong>{observing ? "LIVE" : "WAITING"}</strong>
              <small>{age(state?.account.lastObservedAt)}</small>
            </div>
          </div>
        </div>
      </div>

      <div className="trading-grid">
        <article className="trading-card trading-primary">
          <div className="trading-card-head">
            <span>CURRENT STATE</span>
            <b>{status}</b>
          </div>
          <div className="trading-symbol-row">
            <div>
              <small>SYMBOL</small>
              <strong>{observer?.symbol ?? current?.symbol ?? "—"}</strong>
            </div>
            <div>
              <small>DIRECTION</small>
              <strong>{observer?.side ?? current?.side ?? "—"}</strong>
            </div>
            <div>
              <small>QTY</small>
              <strong>{observer?.quantity ?? current?.quantity ?? "—"}</strong>
            </div>
            <div>
              <small>ORDER</small>
              <strong>{observer?.orderType ?? "—"}</strong>
            </div>
          </div>

          <div className="trading-prices">
            <Metric label="ENTRY" value={number(observer?.entryPrice ?? current?.entryPrice)} />
            <Metric label="CURRENT" value={number(observer?.currentPrice)} />
            <Metric label="STOP" value={number(observer?.stopPrice ?? current?.stopPrice)} />
            <Metric label="TARGET" value={number(observer?.targetPrice ?? current?.targetPrice)} />
            <Metric label="OPEN P&L" value={money(observer?.openPnl ?? state?.account.openPnl)} strong />
            <Metric label="VISION CONF." value={observing ? `${confidence}%` : "—"} />
          </div>
        </article>

        <article className="trading-card">
          <div className="trading-card-head">
            <span>ACCOUNT CONTEXT</span>
            <b>{state?.account.connection ?? "DISCONNECTED"}</b>
          </div>
          <div className="trading-lines">
            <Line label="Prop firm" value={state?.account.propFirm ?? "Lucid Trading"} />
            <Line label="Execution" value={state?.account.provider === "NOT CONNECTED" ? "Tradovate via TradingView" : state?.account.provider ?? "Tradovate via TradingView"} />
            <Line label="Balance" value={money(state?.account.balance)} />
            <Line label="Equity" value={money(state?.account.equity)} />
            <Line label="Closed P&L" value={money(state?.account.closedPnl)} />
            <Line label="Goal" value={state?.account.stage ?? "PASS CURRENT ACCOUNT"} />
          </div>
        </article>

        <article className="trading-card">
          <div className="trading-card-head">
            <span>TODAY</span>
            <Activity size={15} />
          </div>
          <div className="trading-stat-grid">
            <Stat label="TRADES" value={state?.today.trades ?? 0} />
            <Stat label="WINS" value={state?.today.wins ?? 0} />
            <Stat label="LOSSES" value={state?.today.losses ?? 0} />
            <Stat label="REALIZED" value={money(state?.today.realizedPnl)} />
          </div>
        </article>

        <article className="trading-card trading-learning">
          <div className="trading-card-head">
            <span>DEVIANT LEARNING</span>
            <TrendingUp size={15} />
          </div>
          <div className="learning-state">
            <strong>{sampleCount > 0 ? "COLLECTING EVIDENCE" : "WAITING FOR VERIFIED TRADES"}</strong>
            <p>
              Mission: reproduce Dwight&apos;s live entry logic, then tighten timing and filters while keeping the strategy recognizable.
            </p>
          </div>
          <div className="trading-lines">
            <Line label="Observed trade samples" value={String(sampleCount)} />
            <Line label="Target signal density" value="~1–2 highest-quality trades/day" />
            <Line label="Chart output" value="Blue buy arrow · Black sell arrow only" />
            <Line label="Code authority" value="Free to revise internals; strategy + evidence constrained" />
          </div>
          <div className="trading-guard">
            <ShieldCheck size={14} />
            Production revisions stay evidence-gated. No claimed accuracy improvement until unseen/shadow trades support it.
          </div>
        </article>
      </div>
    </section>
  );
}

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={strong ? "metric-strong" : ""}><span>{label}</span><b>{value}</b></div>;
}

function Line({ label, value }: { label: string; value: string }) {
  return <div className="trading-line"><span>{label}</span><b>{value}</b></div>;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="trading-stat"><span>{label}</span><strong>{value}</strong></div>;
}
