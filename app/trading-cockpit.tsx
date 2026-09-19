"use client";

import { Activity, Crosshair, Eye, Gauge, Radio, ShieldCheck, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

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

type PayoutRange = "30D" | "6M" | "ALL";

type PayoutSummary = {
  range: PayoutRange;
  connected: boolean;
  source: string;
  count: number;
  totalNet: number;
  totalGross: number;
  averageNet: number | null;
  latest: { approvedAt: string; traderNetAmount: number } | null;
};

type ObserverLink = {
  deviceId: string;
  deviceName: string;
  pairedAt: string;
  lastHeartbeatAt: string | null;
  lastFrameAt: string | null;
  command: "WATCH" | "PAUSE";
  observerVersion: string | null;
  online: boolean;
};

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
  const [controllerToken, setControllerToken] = useState("");
  const [link, setLink] = useState<ObserverLink | null>(null);
  const [pairCode, setPairCode] = useState("");
  const [pairBusy, setPairBusy] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [linkAuthFailed, setLinkAuthFailed] = useState(false);
  const linkAuthFailures = useRef(0);
  const [payoutRange, setPayoutRange] = useState<PayoutRange>("ALL");
  const [payoutSummary, setPayoutSummary] = useState<PayoutSummary | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("jarvis-observer-controller-v1") ?? "";
    setControllerToken(saved);
  }, []);

  useEffect(() => {
    if (!controllerToken) {
      setLink(null);
      return;
    }
    let cancelled = false;

    async function refreshLink() {
      try {
        const response = await fetch("/api/trading/link/status", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${controllerToken}` },
        });
        if (response.status === 401) {
          linkAuthFailures.current += 1;
          if (!cancelled && linkAuthFailures.current >= 3) {
            setLinkAuthFailed(true);
            setLink((previous) => previous ? { ...previous, online: false } : previous);
          }
          return;
        }
        if (!response.ok) return;
        linkAuthFailures.current = 0;
        if (!cancelled) setLinkAuthFailed(false);
        const payload = await response.json() as { link?: ObserverLink };
        if (!cancelled && payload.link) setLink(payload.link);
      } catch {
        // Trading state polling continues even if link status is temporarily unavailable.
      }
    }

    void refreshLink();
    const timer = window.setInterval(refreshLink, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [controllerToken]);

  useEffect(() => {
    let cancelled = false;

    async function refreshPayouts() {
      try {
        const response = await fetch(`/api/trading/payouts?range=${payoutRange}`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { summary?: PayoutSummary };
        if (!cancelled && payload.summary) setPayoutSummary(payload.summary);
      } catch {
        // Payout analytics stay unavailable until the ledger source is connected.
      }
    }

    void refreshPayouts();
    const timer = window.setInterval(refreshPayouts, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [payoutRange]);

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

  const controlWatching = link?.command === "WATCH";
  const paired = Boolean(controllerToken && link && !linkAuthFailed);
  const frameAgeMs = link?.lastFrameAt ? Date.now() - Date.parse(link.lastFrameAt) : Number.POSITIVE_INFINITY;
  const frameFresh = Number.isFinite(frameAgeMs) && frameAgeMs < 10_000;
  const liveStateFresh = paired && Boolean(link?.online) && controlWatching && observing && frameFresh;
  const displayStatus = !paired
    ? "UNLINKED"
    : !link?.online
      ? "OFFLINE"
      : !controlWatching
        ? "PAUSED"
        : !observing
          ? "WAITING"
          : status;
  const liveLabel = useMemo(() => {
    if (error) return "STATE ERROR";
    if (!paired) return "PAIR DESKTOP OBSERVER";
    if (!link?.online) return "DESKTOP OFFLINE";
    if (!controlWatching) return "OBSERVER PAUSED";
    if (controlWatching && (!observing || !frameFresh)) return "WATCHING · WAITING FOR FRESH FRAME";
    if (status === "PENDING") return "WATCHING PENDING ORDER";
    if (status === "OPEN") return "WATCHING LIVE POSITION";
    if (status === "FLAT") return "WATCHING · FLAT";
    return "WATCHING";
  }, [controlWatching, error, frameFresh, link?.online, observing, paired, status]);

  async function confirmPairing() {
    const code = pairCode.trim().toUpperCase();
    if (!code || pairBusy) return;
    setPairBusy(true);
    setPairError(null);
    try {
      const response = await fetch("/api/trading/pair/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string; pair?: { controllerToken?: string } };
      const token = payload.pair?.controllerToken;
      if (!response.ok || !token) throw new Error(payload.error || "Pairing failed.");
      window.localStorage.setItem("jarvis-observer-controller-v1", token);
      linkAuthFailures.current = 0;
      setLinkAuthFailed(false);
      setLink(null);
      setControllerToken(token);
      setPairCode("");
    } catch (pairingError) {
      setPairError(pairingError instanceof Error ? pairingError.message : "Pairing failed.");
    } finally {
      setPairBusy(false);
    }
  }

  function resetPairing() {
    window.localStorage.removeItem("jarvis-observer-controller-v1");
    setControllerToken("");
    setLink(null);
    setLinkAuthFailed(false);
    linkAuthFailures.current = 0;
    setPairError(null);
    setPairCode("");
  }

  async function setWatching(nextWatching: boolean) {
    if (!controllerToken) return;
    try {
      const response = await fetch("/api/trading/control", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${controllerToken}`,
        },
        body: JSON.stringify({ command: nextWatching ? "WATCH" : "PAUSE" }),
      });
      const payload = await response.json() as { link?: ObserverLink };
      if (response.ok && payload.link) setLink(payload.link);
    } catch {
      // Link poll will recover the true command state.
    }
  }

  return (
    <section className="trading-cockpit">
      <div className="trading-hero">
        <div>
          <span className="trading-kicker"><Eye size={14} /> JARVIS TRADING OBSERVER</span>
          <h2>{liveLabel}</h2>
          <p>
            Learn Dwight&apos;s real entries first. DEVIANT stays aligned to the demonstrated strategy and is refined from evidence, not guesses.
          </p>
        </div>
        <div className="observer-control-stack">
          <button
            type="button"
            className={`observer-record-control ${controlWatching ? "is-watching" : "is-paused"} ${paired ? "is-real" : "is-mock"}`}
            onClick={() => void setWatching(!controlWatching)}
            aria-pressed={controlWatching}
            aria-label={controlWatching ? "Pause observer" : "Start observer"}
            title={paired ? "Control the paired Windows observer" : "Pair the Windows observer first"}
            disabled={!paired}
          >
            <span className="observer-record-ring">
              <span className="observer-record-core" />
            </span>
            <span className="observer-control-copy">
              <small>{paired ? "OBSERVER CONTROL" : "PAIR REQUIRED"}</small>
              <strong>{controlWatching ? "WATCHING" : "PAUSED"}</strong>
              <em>{paired ? (link?.online ? "DESKTOP LINK ONLINE" : "DESKTOP OFFLINE") : "ENTER PAIR CODE BELOW"}</em>
            </span>
          </button>
          <div className={`trading-live-badge ${paired && link?.online ? "is-live" : ""}`}>
            <Radio size={16} />
            <div>
              <span>OBSERVER LINK</span>
              <strong>{paired ? (link?.online ? "ONLINE" : "PAIRED") : "WAITING"}</strong>
              <small>{paired ? `${link?.observerVersion ?? "OBSERVER"} · ${age(link?.lastHeartbeatAt)}` : "PAIRING REQUIRED"}</small>
            </div>
          </div>
        </div>
        {!paired ? (
          <div className="observer-pair-row">
            <input
              value={pairCode}
              onChange={(event) => setPairCode(event.target.value.toUpperCase())}
              placeholder="PAIR CODE FROM DESKTOP"
              maxLength={12}
              aria-label="Observer pairing code"
            />
            <button type="button" onClick={() => void confirmPairing()} disabled={pairBusy || pairCode.trim().length < 6}>
              {pairBusy ? "PAIRING..." : "PAIR OBSERVER"}
            </button>
            {pairError && <small>{pairError}</small>}
          </div>
        ) : (
          <div className="observer-repair-row">
            <small>{link?.deviceName ?? "Windows Observer"} paired</small>
            <button type="button" onClick={resetPairing}>RE-PAIR DEVICE</button>
          </div>
        )}
      </div>

      <div className="trading-grid">
        <article className="trading-card trading-primary">
          <div className="trading-card-head">
            <span>CURRENT STATE</span>
            <b>{displayStatus}</b>
          </div>
          <div className="trading-symbol-row">
            <div>
              <small>SYMBOL</small>
              <strong>{liveStateFresh ? (observer?.symbol ?? current?.symbol ?? "—") : "—"}</strong>
            </div>
            <div>
              <small>DIRECTION</small>
              <strong>{liveStateFresh ? (observer?.side ?? current?.side ?? "—") : "—"}</strong>
            </div>
            <div>
              <small>QTY</small>
              <strong>{liveStateFresh ? (observer?.quantity ?? current?.quantity ?? "—") : "—"}</strong>
            </div>
            <div>
              <small>ORDER</small>
              <strong>{liveStateFresh ? (observer?.orderType ?? "—") : "—"}</strong>
            </div>
          </div>

          <div className="trading-prices">
            <Metric label="ENTRY" value={liveStateFresh ? number(observer?.entryPrice ?? current?.entryPrice) : "—"} />
            <Metric label="CURRENT" value={liveStateFresh ? number(observer?.currentPrice) : "—"} />
            <Metric label="STOP" value={liveStateFresh ? number(observer?.stopPrice ?? current?.stopPrice) : "—"} />
            <Metric label="TARGET" value={liveStateFresh ? number(observer?.targetPrice ?? current?.targetPrice) : "—"} />
            <Metric label="OPEN P&L" value={liveStateFresh ? money(observer?.openPnl ?? state?.account.openPnl) : "—"} strong />
            <Metric label="VISION CONF." value={liveStateFresh ? `${confidence}%` : "—"} />
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

        <article className="trading-card trading-payouts">
          <div className="trading-card-head">
            <span>PAYOUTS</span>
            <div className="payout-range-tabs" aria-label="Payout date range">
              {(["30D", "6M", "ALL"] as PayoutRange[]).map((range) => (
                <button
                  key={range}
                  type="button"
                  className={payoutRange === range ? "active" : ""}
                  onClick={() => setPayoutRange(range)}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>
          <div className="payout-total">
            <span>{payoutRange === "ALL" ? "ALL-TIME NET PAYOUTS" : `${payoutRange} NET PAYOUTS`}</span>
            <strong>{payoutSummary?.connected ? money(payoutSummary.totalNet) : "—"}</strong>
            <small>{payoutSummary?.connected ? `${payoutSummary.count} payouts · avg ${money(payoutSummary.averageNet)}` : "Lucid payout history not connected yet"}</small>
          </div>
          <div className="trading-lines">
            <Line label="Source" value={payoutSummary?.source ?? "PENDING"} />
            <Line label="Latest payout" value={payoutSummary?.latest ? money(payoutSummary.latest.traderNetAmount) : "—"} />
            <Line label="Latest approved" value={payoutSummary?.latest ? new Date(payoutSummary.latest.approvedAt).toLocaleDateString() : "—"} />
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
