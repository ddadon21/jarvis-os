"use client";

import { Activity, Crosshair, Eye, Gauge, Radio, ShieldCheck, TriangleAlert, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import TradingAccountManager, { TradingAccountView } from "./trading-account-manager";
import { observerPhase, phaseLabel, type ObserverPhase } from "../lib/trading-phase";

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
  intentState?: "NONE" | "PREPARING" | "ORDER_WORKING" | "POSITION_OPEN" | "UNKNOWN";
  orderTicketVisible?: boolean;
  readingIssue?: string | null;
  phase?: ObserverPhase;
  filledAt?: string | null;
};

type ObserverDiagnostics = {
  day: string;
  observerVersion: string;
  generatedAt: string;
  reads: number;
  readMsP95: number | null;
  activeReads: number;
  missingFieldRate: Record<string, number | null>;
  wrongSymbolRate: number | null;
  suspectedFalseOrderEvents: number;
  suspectedFalseTrades: number;
  cancelClears: number;
  cancelClearMsP95: number | null;
  perSymbol: Record<string, { activeReads: number; completeReads: number; episodes: number; fills: number; suspect: number }>;
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
  guardrails?: {
    rules: {
      maxTradesPerDay: number;
      riskTargetDollars: number;
    };
    todayTradeCount: number;
    remainingTrades: number;
    plannedRisk: number | null;
    activeAlert: {
      id: string;
      rule: "TRADE_COUNT" | "RISK_LIMIT";
      severity: "WARNING" | "VIOLATION";
      title: string;
      message: string;
      observedAt: string;
      symbol: string | null;
      side: "LONG" | "SHORT" | null;
      tradeNumber: number | null;
      plannedRisk: number | null;
    } | null;
    eventsToday: Array<{
      id: string;
      rule: "TRADE_COUNT" | "RISK_LIMIT";
      severity: "WARNING" | "VIOLATION";
      title: string;
      message: string;
      observedAt: string;
    }>;
  };
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

type ApiResponse = { state: TradingState; observing: boolean; observerDiagnostics?: ObserverDiagnostics | null };

type PayoutRange = "30D" | "6M" | "ALL";

type PayoutSummary = {
  range: PayoutRange;
  connected: boolean;
  source: string;
  count: number;
  recordedCount?: number;
  lifetimeCount?: number;
  nextPayoutNumber?: number;
  unitemizedCount?: number;
  totalAmount?: number;
  totalNet: number;
  totalGross: number;
  averageAmount?: number | null;
  averageNet: number | null;
  latest: { approvedAt: string | null; payoutAmount?: number; traderNetAmount: number | null; firm?: string } | null;
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

function safeTradingSymbol(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  if (["CLASS", "BUTTON", "GROUP", "TEXT", "ORDER", "ORDERS", "POSITION", "POSITIONS", "BUY", "SELL"].includes(normalized)) {
    return null;
  }
  return normalized;
}

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
  const [selectedAccount, setSelectedAccount] = useState<TradingAccountView | null>(null);
  const lastAlertSoundId = useRef<string | null>(null);

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
    const timer = window.setInterval(refresh, 750);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const state = data?.state;
  const observer = state?.observer;
  const observing = data?.observing === true;
  const current = state?.openTrades.find(trade => observer?.status === "OPEN" && trade.symbol === observer.symbol && trade.side === observer.side);
  const status = observer?.status ?? (current ? "OPEN" : "UNKNOWN");
  const sampleCount = (state?.recentTrades.length ?? 0) + (state?.openTrades.length ?? 0);
  const confidence = Math.round((observer?.confidence ?? 0) * 100);

  const controlWatching = link?.command === "WATCH";
  const paired = Boolean(controllerToken && link && !linkAuthFailed);
  const frameAgeMs = link?.lastFrameAt ? Date.now() - Date.parse(link.lastFrameAt) : Number.POSITIVE_INFINITY;
  const frameFresh = Number.isFinite(frameAgeMs) && frameAgeMs < 45_000;
  const observationAgeMs = Date.now() - Date.parse(observer?.observedAt ?? "");
  const observationFresh = Number.isFinite(observationAgeMs) && observationAgeMs >= 0 && observationAgeMs < 45_000;
  const liveStateFresh = paired && Boolean(link?.online) && controlWatching && observing && frameFresh;
  // Exactly one of the five Observer phases. Link problems are reported
  // separately so a stale connection never masquerades as a trading state.
  const phase: ObserverPhase = observer?.phase ?? observerPhase(observer);
  const executionActive = phase !== "WAITING";
  const linkIssue = !paired
    ? "UNLINKED"
    : !link?.online
      ? "DESKTOP OFFLINE"
      : !controlWatching
        ? "OBSERVER PAUSED"
        : !observing || !frameFresh
          ? "NO FRESH FRAMES"
          : !observationFresh || (observer?.readingIssue && !executionActive)
            ? "READING UNAVAILABLE"
            : null;
  const displayStatus = phaseLabel(phase);
  const diagnostics = data?.observerDiagnostics ?? null;
  const showExecutionDetails = liveStateFresh && observationFresh && executionActive;
  const guardrails = state?.guardrails;
  const activeAlert = liveStateFresh ? guardrails?.activeAlert ?? null : null;

  useEffect(() => {
    if (!activeAlert || activeAlert.id === lastAlertSoundId.current) return;
    lastAlertSoundId.current = activeAlert.id;
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(activeAlert.severity === "VIOLATION" ? 620 : 520, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(activeAlert.severity === "VIOLATION" ? 880 : 700, context.currentTime + 0.22);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.34);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.36);
      window.setTimeout(() => void context.close(), 500);
    } catch {
      // Browser audio policy can block alerts until the page has received a user gesture.
    }
  }, [activeAlert]);

  const liveLabel = useMemo(() => {
    if (error) return "STATE ERROR";
    if (!paired) return "PAIR DESKTOP OBSERVER";
    if (!link?.online) return "DESKTOP OFFLINE";
    if (!controlWatching) return "OBSERVER PAUSED";
    if (linkIssue) return linkIssue;
    return phaseLabel(phase);
  }, [controlWatching, error, linkIssue, link?.online, paired, phase]);

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
      window.dispatchEvent(new CustomEvent("jarvis-observer-link-updated"));
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
    window.dispatchEvent(new CustomEvent("jarvis-observer-link-updated"));
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
              <em>{paired ? (link?.online ? "DESKTOP LINK ONLINE" : "PAIRED - WAITING FOR LOCAL AGENT HEARTBEAT") : "ENTER PAIR CODE BELOW"}</em>
            </span>
          </button>
          <div className={`trading-live-badge ${paired && link?.online ? "is-live" : ""}`}>
            <Radio size={16} />
            <div>
              <span>OBSERVER LINK</span>
              <strong>{paired ? (link?.online ? "ONLINE" : "PAIRED - NO HEARTBEAT") : "WAITING"}</strong>
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

      {activeAlert ? (
        <div className={`jarvis-rule-alert ${activeAlert.severity === "VIOLATION" ? "is-violation" : "is-warning"}`} role="alert" aria-live="assertive">
          <div className="jarvis-rule-alert-orb" aria-hidden="true">
            <span className="jarvis-rule-alert-ring outer" />
            <span className="jarvis-rule-alert-ring inner" />
            <span className="jarvis-rule-alert-core"><TriangleAlert size={34} strokeWidth={1.8} /></span>
          </div>
          <div className="jarvis-rule-alert-copy">
            <small>JARVIS TRADING GUARDRAIL</small>
            <strong>{activeAlert.title}</strong>
            <p>{activeAlert.message}</p>
            <span>{activeAlert.rule === "TRADE_COUNT" ? "DAILY TRADE RULE" : "PLANNED RISK RULE"} · {activeAlert.severity}</span>
          </div>
        </div>
      ) : null}

      <TradingAccountManager onAccountChange={setSelectedAccount} />

      <div className="trading-grid">
        <article className="trading-card trading-primary">
          <div className="trading-card-head">
            <span>CURRENT STATE</span>
            <b data-phase={phase}>{displayStatus}</b>
          </div>
          {linkIssue ? <small role="status" style={{ fontSize: 11, letterSpacing: ".08em", color: "#c9a0a4" }}>LINK · {linkIssue} — showing the last known state</small> : null}
          {liveStateFresh && observer?.readingIssue ? <small role="status">{observer.readingIssue}</small> : null}
          <div className="trading-symbol-row">
            <div>
              <small>SYMBOL</small>
              <strong>{showExecutionDetails ? (safeTradingSymbol(observer?.symbol) ?? safeTradingSymbol(current?.symbol) ?? "—") : "—"}</strong>
            </div>
            <div>
              <small>DIRECTION</small>
              <strong>{showExecutionDetails ? (observer?.side ?? current?.side ?? "—") : "—"}</strong>
            </div>
            <div>
              <small>QTY</small>
              <strong>{showExecutionDetails ? (observer?.quantity ?? current?.quantity ?? "—") : "—"}</strong>
            </div>
            <div>
              <small>ORDER</small>
              <strong>{showExecutionDetails ? (observer?.orderType ?? (status === "OPEN" ? "FILLED" : "READING")) : "—"}</strong>
            </div>
          </div>

          <div className="trading-prices">
            <Metric label="ENTRY" value={showExecutionDetails ? number(observer?.entryPrice ?? current?.entryPrice) : "—"} />
            <Metric label="CURRENT" value={showExecutionDetails ? number(observer?.currentPrice) : "—"} />
            <Metric label="STOP" value={showExecutionDetails ? number(observer?.stopPrice ?? current?.stopPrice) : "—"} />
            <Metric label="TARGET" value={showExecutionDetails ? number(observer?.targetPrice ?? current?.targetPrice) : "—"} />
            <Metric
              label="OPEN P&L"
              value={showExecutionDetails && status === "OPEN" ? money(observer?.openPnl) : showExecutionDetails ? "NOT OPEN" : "—"}
              strong
            />
            <Metric label="READ CONF." value={showExecutionDetails ? `${confidence}%` : "—"} />
          </div>
        </article>

        <article className="trading-card">
          <div className="trading-card-head">
            <span>ACCOUNT CONTEXT</span>
            <b>{selectedAccount ? `${selectedAccount.stage} · ${selectedAccount.label}` : state?.account.connection ?? "DISCONNECTED"}</b>
          </div>
          <div className="trading-lines">
            <Line label="Prop firm" value={selectedAccount?.firm ?? state?.account.propFirm ?? "Lucid Trading"} />
            <Line label="Execution" value={state?.account.provider === "NOT CONNECTED" ? "Tradovate via TradingView" : state?.account.provider ?? "Tradovate via TradingView"} />
            <Line label="Balance" value={selectedAccount ? money(selectedAccount.currentBalance) : money(state?.account.balance)} />
            <Line label="Equity" value={selectedAccount ? money(selectedAccount.currentBalance) : money(state?.account.equity)} />
            <Line label="Closed P&L" value={selectedAccount ? money(selectedAccount.totalPnl) : money(state?.account.closedPnl)} />
            <Line
              label="Goal"
              value={
                selectedAccount
                  ? selectedAccount.stage === "EVAL"
                    ? `${money(selectedAccount.remaining)} TO PASS`
                    : `${selectedAccount.tradingDays}/${selectedAccount.requiredTradingDays} DAYS · ${money(selectedAccount.remaining)} BUFFER LEFT`
                  : state?.account.stage ?? "PASS CURRENT ACCOUNT"
              }
            />
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
          <div className="trading-rule-strip">
            <div>
              <span>DAILY LIMIT</span>
              <b>{guardrails ? `${guardrails.todayTradeCount}/${guardrails.rules.maxTradesPerDay}` : "—"}</b>
            </div>
            <div>
              <span>TRADES LEFT</span>
              <b>{guardrails?.remainingTrades ?? "—"}</b>
            </div>
            <div>
              <span>PLANNED RISK</span>
              <b>{guardrails?.plannedRisk == null ? "—" : money(guardrails.plannedRisk)}</b>
            </div>
            <div>
              <span>RISK TARGET</span>
              <b>{guardrails ? money(guardrails.rules.riskTargetDollars) : "—"}</b>
            </div>
            <div>
              <span>RULE EVENTS</span>
              <b>{guardrails?.eventsToday.length ?? 0}</b>
            </div>
          </div>
        </article>

        <article className="trading-card">
          <div className="trading-card-head">
            <span>OBSERVER RELIABILITY</span>
            <b>{diagnostics ? `${diagnostics.day} · v${diagnostics.observerVersion}` : "NO DATA YET"}</b>
          </div>
          {diagnostics ? (
            <div className="trading-lines">
              <Line label="Reads / active" value={`${diagnostics.reads} / ${diagnostics.activeReads}`} />
              <Line label="Read latency p95" value={ms(diagnostics.readMsP95)} />
              <Line label="Worst missing field" value={worstMissing(diagnostics.missingFieldRate)} />
              <Line label="Symbol vs. window title" value={diagnostics.wrongSymbolRate == null ? "NOT COMPARABLE YET" : `${pct(diagnostics.wrongSymbolRate)} MISMATCH`} />
              <Line label="Cancel → waiting p95" value={diagnostics.cancelClears ? `${ms(diagnostics.cancelClearMsP95)} (${diagnostics.cancelClears})` : "NO CANCELS YET"} />
              <Line label="Suspected false events" value={`${diagnostics.suspectedFalseOrderEvents} order · ${diagnostics.suspectedFalseTrades} trade`} />
              <Line label="Complete reads by symbol" value={symbolCompleteness(diagnostics.perSymbol)} />
            </div>
          ) : (
            <small>Observer 1.1 uploads a daily reliability snapshot every 5 minutes while TradingView is open.</small>
          )}
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
            <span>{selectedAccount?.stage === "FUNDED" ? "CURRENT FUNDED CYCLE" : payoutRange === "ALL" ? "RECORDED LIFETIME PAYOUT AMOUNTS" : `${payoutRange} LIFETIME PAYOUT AMOUNTS`}</span>
            <strong>{selectedAccount?.stage === "FUNDED" ? `${selectedAccount.fundedPayoutCount} PAYOUT${selectedAccount.fundedPayoutCount === 1 ? "" : "S"}` : payoutSummary?.connected ? money(payoutSummary.totalAmount ?? payoutSummary.totalGross ?? payoutSummary.totalNet) : "—"}</strong>
            <small>
              {selectedAccount?.stage === "FUNDED"
                ? `CURRENT FUNDED CYCLE: ${selectedAccount.fundedPayoutCount} PAYOUTS · LIFETIME RECORD: ${payoutSummary?.lifetimeCount ?? payoutSummary?.count ?? 0}`
                : payoutSummary?.connected
                  ? `Lifetime record: ${payoutSummary.lifetimeCount ?? payoutSummary.count} payouts · #${payoutSummary.nextPayoutNumber ?? (payoutSummary.count + 1)} next`
                  : "Payout history not connected yet"}
            </small>
            {payoutSummary?.connected && (payoutSummary.unitemizedCount ?? 0) > 0 ? (
              <small>{payoutSummary.recordedCount ?? payoutSummary.count} payout amount on file · {payoutSummary.unitemizedCount} earlier payouts not itemized</small>
            ) : null}
          </div>
          <div className="trading-lines">
            <Line label="Lifetime recorded amount" value={payoutSummary?.connected ? money(payoutSummary.totalAmount ?? payoutSummary.totalGross ?? payoutSummary.totalNet) : "—"} />
            <Line label="Source" value={payoutSummary?.source ?? "PENDING"} />
            <Line label={selectedAccount?.stage === "FUNDED" ? "Current cycle payouts" : "Lifetime payouts"} value={selectedAccount?.stage === "FUNDED" ? String(selectedAccount.fundedPayoutCount) : String(payoutSummary?.lifetimeCount ?? payoutSummary?.count ?? 0)} />
            <Line label="Latest lifetime payout" value={payoutSummary?.latest ? money(payoutSummary.latest.payoutAmount ?? payoutSummary.latest.traderNetAmount) : "—"} />
            <Line label="Latest approved" value={payoutSummary?.latest?.approvedAt ? new Date(payoutSummary.latest.approvedAt).toLocaleDateString() : "DATE NOT RECORDED"} />
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

function ms(value: number | null | undefined) {
  return value == null ? "—" : value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

function pct(value: number) {
  return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
}

function worstMissing(rates: Record<string, number | null>) {
  const worst = Object.entries(rates).filter((entry): entry is [string, number] => entry[1] != null).sort((a, b) => b[1] - a[1])[0];
  return worst ? (worst[1] === 0 ? "NONE MISSING" : `${worst[0].toUpperCase()} ${pct(worst[1])}`) : "NO ACTIVE READS";
}

function symbolCompleteness(perSymbol: ObserverDiagnostics["perSymbol"]) {
  const entries = Object.entries(perSymbol).filter(([, stats]) => stats.activeReads > 0);
  if (!entries.length) return "NO ACTIVE READS";
  return entries.map(([symbol, stats]) => `${symbol} ${pct(stats.completeReads / stats.activeReads)}`).join(" · ");
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
