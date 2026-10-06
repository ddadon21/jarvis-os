"use client";

import { Activity, Crosshair, Radio, ShieldAlert, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import styles from "./agents-floor.module.css";
import { LifetimeEarnedStat, lifetimeEarnedTitle, lifetimeEarnedValue, useLifetimeEarned } from "./lifetime-earned";
import {
  profileFor,
  quickEvent,
  timeAgo,
  type AgentProfile,
  type WorkforceAgent,
  type WorkforceEvent,
  type WorkforceTask,
} from "./agent-profiles";

/* ------------------------------------------------------------------ */
/* Trading feed (read-only view of /api/trading/state)                 */
/* ------------------------------------------------------------------ */

type ObserverRead = {
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
  readingIssue?: string | null;
};

type TradeRow = {
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

type TradingSnapshot = {
  account: {
    provider: string;
    propFirm: string | null;
    connection: "DISCONNECTED" | "CONNECTING" | "OBSERVING" | "DEGRADED";
    stage: string;
    balance: number | null;
    equity: number | null;
    lastObservedAt: string | null;
  };
  observer?: ObserverRead;
  openTrades: TradeRow[];
  recentTrades: TradeRow[];
  guardrails?: {
    rules: { maxTradesPerDay: number; riskTargetDollars: number };
    todayTradeCount: number;
    remainingTrades: number;
    plannedRisk: number | null;
    activeAlert: { id: string; severity: "WARNING" | "VIOLATION"; title: string; message: string } | null;
  };
  journalCount: number;
  today: { trades: number; wins: number; losses: number; realizedPnl: number };
  /** Count from durable storage; null when Supabase persistence is not configured. */
  durableTradeCount?: number | null;
};

type Tick = { t: number; p: number };

const MAX_TICKS = 720;
const OBSERVER_STALE_MS = 60_000;
/** Rough sample size before a first evidence-backed DEVIANT candidate is worth testing. */
const FIRST_CANDIDATE_TARGET = 300;

function useTradingFeed(fast: boolean) {
  const [state, setState] = useState<TradingSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [tickVersion, setTickVersion] = useState(0);
  const ticksRef = useRef<Tick[]>([]);
  const symbolRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    const recordTick = (snapshot: TradingSnapshot) => {
      const observer = snapshot.observer;
      if (!observer || typeof observer.currentPrice !== "number" || !Number.isFinite(observer.currentPrice)) return;
      const symbol = observer.symbol ?? null;
      if (symbol !== symbolRef.current) {
        symbolRef.current = symbol;
        ticksRef.current = [];
      }
      const parsed = Date.parse(observer.observedAt ?? "");
      const t = Number.isFinite(parsed) ? parsed : Date.now();
      const last = ticksRef.current[ticksRef.current.length - 1];
      if (last && t <= last.t) return;
      ticksRef.current = [...ticksRef.current, { t, p: observer.currentPrice }].slice(-MAX_TICKS);
      setTickVersion((value) => value + 1);
    };

    const schedule = () => {
      if (!cancelled) timer = window.setTimeout(load, fast ? 2_000 : 6_000);
    };

    async function load() {
      if (document.hidden) {
        schedule();
        return;
      }
      try {
        const response = await fetch("/api/trading/state", { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { state?: TradingSnapshot; durableTradeCount?: number | null };
        if (cancelled) return;
        if (body.state) {
          const snapshot = { ...body.state, durableTradeCount: body.durableTradeCount ?? null };
          setState(snapshot);
          recordTick(snapshot);
        }
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
      schedule();
    }

    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fast]);

  return { state, failed, ticks: ticksRef.current, tickVersion };
}

/* ------------------------------------------------------------------ */
/* Floor plan geometry                                                 */
/* ------------------------------------------------------------------ */

type Room = { x: number; y: number; w: number; h: number; path: string };
type FloorLayout = {
  width: number;
  height: number;
  fs: number;
  core: { cx: number; cy: number; r: number };
  rooms: Record<string, Room>;
};

const LANDSCAPE: FloorLayout = {
  width: 1200,
  height: 720,
  fs: 1,
  core: { cx: 600, cy: 380, r: 70 },
  rooms: {
    EXECUTIVE: { x: 470, y: 30, w: 260, h: 150, path: "M600 180 V380" },
    FINANCE_CFO: { x: 40, y: 30, w: 300, h: 190, path: "M340 125 H440 V350 H600" },
    SENTRYOPS_RESEARCH: { x: 860, y: 30, w: 300, h: 190, path: "M860 125 H760 V350 H600" },
    TRADING_OBSERVER: { x: 40, y: 260, w: 340, h: 230, path: "M380 375 H600" },
    BUILDER: { x: 820, y: 260, w: 340, h: 230, path: "M820 375 H600" },
    JARVIS_QA: { x: 40, y: 530, w: 250, h: 160, path: "M165 530 V510 H600 V380" },
    IT_INFRA: { x: 330, y: 540, w: 250, h: 150, path: "M455 540 V510 H600 V380" },
    IT_SECURITY: { x: 620, y: 540, w: 250, h: 150, path: "M745 540 V510 H600 V380" },
    IT_INTEGRATIONS: { x: 910, y: 530, w: 250, h: 160, path: "M1035 530 V510 H600 V380" },
  },
};

const PORTRAIT: FloorLayout = {
  width: 720,
  height: 1070,
  fs: 1.45,
  core: { cx: 360, cy: 560, r: 56 },
  rooms: {
    EXECUTIVE: { x: 220, y: 16, w: 280, h: 150, path: "M360 166 V560" },
    FINANCE_CFO: { x: 20, y: 180, w: 300, h: 180, path: "M320 270 H360 V560" },
    SENTRYOPS_RESEARCH: { x: 400, y: 180, w: 300, h: 180, path: "M400 270 H360 V560" },
    TRADING_OBSERVER: { x: 20, y: 390, w: 270, h: 280, path: "M290 560 H360" },
    BUILDER: { x: 430, y: 390, w: 270, h: 280, path: "M430 560 H360" },
    JARVIS_QA: { x: 20, y: 700, w: 300, h: 160, path: "M320 780 H360 V560" },
    IT_INFRA: { x: 400, y: 700, w: 300, h: 160, path: "M400 780 H360 V560" },
    IT_SECURITY: { x: 20, y: 890, w: 300, h: 160, path: "M320 970 H360 V560" },
    IT_INTEGRATIONS: { x: 400, y: 890, w: 300, h: 160, path: "M400 970 H360 V560" },
  },
};

function hashSeed(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Equipment = { x: number; y: number; w: number; h: number; lit: boolean; delay: number };

function buildEquipment(id: string, area: { x: number; y: number; w: number; h: number }): Equipment[] {
  const random = seededRandom(hashSeed(id));
  const cellW = 18;
  const cellH = 14;
  const cols = Math.max(0, Math.floor(area.w / cellW));
  const rows = Math.max(0, Math.floor(area.h / cellH));
  const out: Equipment[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (random() < 0.28) continue;
      out.push({
        x: area.x + c * cellW,
        y: area.y + r * cellH,
        w: 12,
        h: 8,
        lit: random() < 0.22,
        delay: Math.round(random() * 3000),
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Status helpers                                                      */
/* ------------------------------------------------------------------ */

type Tone = "working" | "online" | "standby" | "blocked" | "error";

function toneFor(agent: WorkforceAgent, floorActive: boolean): Tone {
  if (agent.status === "ERROR") return "error";
  if (agent.status === "BLOCKED") return floorActive ? "blocked" : "standby";
  if (!floorActive) return "standby";
  if (agent.status === "RUNNING") return "working";
  return "online";
}

function toneLabel(tone: Tone) {
  if (tone === "working") return "WORKING";
  if (tone === "online") return "ON DUTY";
  if (tone === "blocked") return "BLOCKED";
  if (tone === "error") return "INCIDENT";
  return "OFF DUTY";
}

function fitText(value: string, max: number) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : text.slice(0, Math.max(1, max - 1)).trimEnd() + "…";
}

function isNum(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function price(value: number | null | undefined) {
  return isNum(value) ? value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
}

function money(value: number | null | undefined) {
  if (!isNum(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return sign + "$" + Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function clock(value: string | null | undefined) {
  const parsed = Date.parse(value ?? "");
  if (!Number.isFinite(parsed)) return "--:--";
  return new Date(parsed).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function observerIsLive(state: TradingSnapshot | null) {
  if (!state) return false;
  const connected = state.account.connection === "OBSERVING" || state.account.connection === "DEGRADED";
  const at = Date.parse(state.account.lastObservedAt ?? state.observer?.observedAt ?? "");
  return connected && Number.isFinite(at) && Date.now() - at < OBSERVER_STALE_MS;
}

function observerHeadline(state: TradingSnapshot | null) {
  const observer = state?.observer;
  if (!state || !observer) return "NO OBSERVER READ";
  if (observer.status === "OPEN") return `${observer.side ?? "POSITION"} ${observer.quantity ?? ""} ${observer.symbol ?? ""}`.replace(/\s+/g, " ").trim();
  if (observer.status === "PENDING") return `WORKING ${observer.side ?? "ORDER"} ${observer.symbol ?? ""}`.trim();
  if (observer.intentState === "PREPARING") return `PREPARING ${observer.side ?? "ORDER"} ${observer.symbol ?? ""}`.trim();
  if (observer.status === "FLAT") return `FLAT${observer.symbol ? " · " + observer.symbol : ""}`;
  return "READING CHART";
}

function eventsForAgent(events: WorkforceEvent[], agent: WorkforceAgent, profile: AgentProfile) {
  const id = agent.id.toLowerCase();
  const handoff = profile.handoffName.toUpperCase();
  const direct = events.filter((event) =>
    event.source.toLowerCase().includes(id) ||
    event.summary.toUpperCase().startsWith(handoff + " →") ||
    event.summary.toUpperCase().includes("→ " + handoff + ":"),
  );
  if (direct.length >= 3 || agent.domain === "CORE") return direct.slice(0, 10);
  const domain = events.filter((event) => event.domain === agent.domain && !direct.includes(event));
  return [...direct, ...domain].slice(0, 10);
}

function prefersCalm() {
  if (typeof window === "undefined") return true;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  return reduced || document.documentElement.dataset.jarvisPerformance === "lean";
}

/* ------------------------------------------------------------------ */
/* Floor                                                               */
/* ------------------------------------------------------------------ */

type FloorProps = {
  agents: WorkforceAgent[];
  tasks: WorkforceTask[];
  events: WorkforceEvent[];
  floorActive: boolean;
  selectedId: string;
  onSelect: (id: string) => void;
};

export default function AgentsFloor({ agents, tasks, events, floorActive, selectedId, onSelect }: FloorProps) {
  const [portrait, setPortrait] = useState(false);
  const [calm, setCalm] = useState(true);
  const [deskId, setDeskId] = useState<string | null>(null);
  const trading = useTradingFeed(deskId === "TRADING_OBSERVER");
  const earned = useLifetimeEarned();

  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => setPortrait(query.matches);
    update();
    setCalm(prefersCalm());
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const layout = portrait ? PORTRAIT : LANDSCAPE;
  const deskAgent = deskId ? agents.find((agent) => agent.id === deskId) ?? null : null;

  function openDesk(id: string) {
    onSelect(id);
    setDeskId(id);
  }

  const counts = useMemo(() => {
    const tones = agents.map((agent) => toneFor(agent, floorActive));
    return {
      working: tones.filter((tone) => tone === "working" || tone === "online").length,
      blocked: tones.filter((tone) => tone === "blocked").length,
      incidents: tones.filter((tone) => tone === "error").length,
    };
  }, [agents, floorActive]);

  const liveObserver = observerIsLive(trading.state);
  const feed = events.slice(0, portrait ? 6 : 16);

  return (
    <section className={styles.floorSection} aria-label="Himie Johnson Ventures agents floor">
      <div className={styles.frameTop}>
        <div className={styles.frameTitle}>
          <span>OPERATIONS FLOOR // TOP VIEW</span>
          <strong>HIMIE JOHNSON VENTURES</strong>
        </div>
        <div className={styles.frameStats}>
          <LifetimeEarnedStat feed={earned} />
          <span><i className={styles.dotOnline} /> {counts.working} ON DUTY</span>
          <span><i className={styles.dotBlocked} /> {counts.blocked} BLOCKED</span>
          <span><i className={styles.dotError} /> {counts.incidents} INCIDENT</span>
          <span className={liveObserver ? styles.observerLive : styles.observerOff}>
            <Radio size={10} /> OBSERVER {liveObserver ? "LIVE" : "OFFLINE"}
          </span>
        </div>
      </div>

      <div className={styles.frameBody}>
        <aside className={styles.feedRail} aria-label="Live signal feed">
          <div className={styles.railHead}><Activity size={11} /> SIGNAL FEED</div>
          <div className={styles.feedLines}>
            {feed.map((event) => (
              <div key={event.id} className={styles.feedLine}>
                <b>{clock(event.occurredAt)}</b>
                <span>{quickEvent(event.summary)}</span>
              </div>
            ))}
            {!feed.length ? <div className={styles.feedLine}><b>--:--</b><span>NO SIGNALS YET</span></div> : null}
          </div>
        </aside>

        <div className={styles.mapWrap}>
          <svg
            className={styles.map}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="group"
            aria-label="Floor plan. Select a room to enter that agent's desk."
          >
            <defs>
              <pattern id="hjv-floor-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <path d="M24 0 H0 V24" fill="none" stroke="rgba(183,31,38,.07)" strokeWidth="1" />
              </pattern>
              <radialGradient id="hjv-core-glow">
                <stop offset="0%" stopColor="rgba(255,59,68,.55)" />
                <stop offset="55%" stopColor="rgba(183,31,38,.16)" />
                <stop offset="100%" stopColor="rgba(183,31,38,0)" />
              </radialGradient>
            </defs>
            <rect x="0" y="0" width={layout.width} height={layout.height} fill="url(#hjv-floor-grid)" />

            {/* Corridors under everything */}
            {agents.map((agent) => {
              const room = layout.rooms[agent.id];
              if (!room) return null;
              const tone = toneFor(agent, floorActive);
              return (
                <g key={"corridor-" + agent.id} className={styles["corridor_" + tone]}>
                  <path d={room.path} className={styles.corridorBed} />
                  <path d={room.path} className={styles.corridorLine} />
                </g>
              );
            })}

            {/* Data pulses travelling to / from the core */}
            {!calm && floorActive ? agents.map((agent, index) => {
              const room = layout.rooms[agent.id];
              const tone = toneFor(agent, floorActive);
              if (!room || (tone !== "working" && tone !== "online")) return null;
              const duration = (tone === "working" ? 2.4 : 4.2) + (index % 3) * 0.35;
              return (
                <g key={"pulse-" + agent.id}>
                  <circle r={3.2 * layout.fs} className={styles.pulse}>
                    <animateMotion dur={duration + "s"} repeatCount="indefinite" path={room.path} begin={(index * 0.37) + "s"} />
                  </circle>
                  {tone === "working" ? (
                    <circle r={2.4 * layout.fs} className={styles.pulseReturn}>
                      <animateMotion
                        dur={(duration * 1.3) + "s"}
                        repeatCount="indefinite"
                        path={room.path}
                        keyPoints="1;0"
                        keyTimes="0;1"
                        calcMode="linear"
                        begin={(index * 0.21) + "s"}
                      />
                    </circle>
                  ) : null}
                </g>
              );
            }) : null}

            {agents.map((agent) => {
              const room = layout.rooms[agent.id];
              if (!room) return null;
              return (
                <FloorRoom
                  key={"room-" + agent.id}
                  agent={agent}
                  room={room}
                  layout={layout}
                  tone={toneFor(agent, floorActive)}
                  selected={selectedId === agent.id}
                  trading={agent.id === "TRADING_OBSERVER" ? trading : null}
                  earned={agent.id === "TRADING_OBSERVER" ? earned : null}
                  onOpen={() => openDesk(agent.id)}
                />
              );
            })}

            <g className={styles.core}>
              <circle cx={layout.core.cx} cy={layout.core.cy} r={layout.core.r * 1.7} fill="url(#hjv-core-glow)" className={floorActive ? styles.coreGlowLive : styles.coreGlow} />
              <circle cx={layout.core.cx} cy={layout.core.cy} r={layout.core.r} className={styles.coreRing} />
              <circle cx={layout.core.cx} cy={layout.core.cy} r={layout.core.r * 0.72} className={styles.coreRingDashed} />
              <circle cx={layout.core.cx} cy={layout.core.cy} r={layout.core.r * 0.36} className={styles.coreHeart} />
              <text x={layout.core.cx} y={layout.core.cy + 4 * layout.fs} className={styles.coreLabel} style={{ fontSize: 13 * layout.fs }}>JARVIS</text>
              {layout.fs === 1 ? (
                <text x={layout.core.cx} y={layout.core.cy + layout.core.r + 18} className={styles.coreSub} style={{ fontSize: 9 }}>
                  {floorActive ? "CORE // ORCHESTRATING" : "CORE // STANDBY"}
                </text>
              ) : null}
            </g>
          </svg>
          <div className={styles.mapHint}>TAP A ROOM TO STEP INTO THAT AGENT&apos;S DESK</div>
        </div>

        <aside className={styles.rosterRail} aria-label="Agent roster">
          <div className={styles.railHead}><Crosshair size={11} /> ROSTER</div>
          <div className={styles.roster}>
            {agents.map((agent) => {
              const profile = profileFor(agent);
              const tone = toneFor(agent, floorActive);
              return (
                <button
                  type="button"
                  key={"roster-" + agent.id}
                  className={styles.rosterRow + " " + styles["tone_" + tone] + (selectedId === agent.id ? " " + styles.rosterSelected : "")}
                  style={{ "--agent-accent": profile.accent } as CSSProperties}
                  onClick={() => openDesk(agent.id)}
                >
                  <i />
                  <span>
                    <strong>{profile.name}</strong>
                    <small>{agent.id === "TRADING_OBSERVER" ? observerHeadline(trading.state) : profile.station}</small>
                  </span>
                  <b>{toneLabel(tone)}</b>
                </button>
              );
            })}
          </div>
        </aside>
      </div>

      {deskAgent ? (
        <DeskView
          agent={deskAgent}
          tasks={tasks.filter((task) => task.assignedTo === deskAgent.id)}
          events={eventsForAgent(events, deskAgent, profileFor(deskAgent))}
          allEvents={events}
          floorActive={floorActive}
          trading={trading}
          earned={earned}
          onClose={() => setDeskId(null)}
        />
      ) : null}
    </section>
  );
}

type TradingFeed = ReturnType<typeof useTradingFeed>;
type EarnedFeed = ReturnType<typeof useLifetimeEarned>;

function FloorRoom({
  agent,
  room,
  layout,
  tone,
  selected,
  trading,
  earned,
  onOpen,
}: {
  agent: WorkforceAgent;
  room: Room;
  layout: FloorLayout;
  tone: Tone;
  selected: boolean;
  trading: TradingFeed | null;
  earned: EarnedFeed | null;
  onOpen: () => void;
}) {
  const profile = profileFor(agent);
  const fs = layout.fs;
  const isTrading = Boolean(trading);
  const equipmentArea = isTrading
    ? { x: room.x + room.w * 0.08, y: room.y + room.h - 24 * fs, w: room.w * 0.84, h: 14 * fs }
    : { x: room.x + room.w * 0.5, y: room.y + 54 * fs, w: room.w * 0.46, h: room.h - 84 * fs };
  const equipment = useMemo(
    () => buildEquipment(agent.id + ":" + layout.width, equipmentArea),
    [agent.id, layout.width, room.x, room.y, room.w, room.h],
  );

  const deskX = isTrading ? room.x + room.w * 0.2 : room.x + room.w * 0.26;
  const compact = layout.fs > 1;
  const deskY = isTrading
    ? room.y + room.h * 0.52
    : compact ? room.y + room.h - 30 * fs : room.y + room.h * 0.66;

  function onKey(event: KeyboardEvent<SVGGElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    }
  }

  return (
    <g
      className={styles.room + " " + styles["tone_" + tone] + (selected ? " " + styles.roomSelected : "")}
      style={{ "--agent-accent": profile.accent } as CSSProperties}
      role="button"
      tabIndex={0}
      aria-label={`${profile.name} · ${profile.role} · ${toneLabel(tone)}. Open desk.`}
      onClick={onOpen}
      onKeyDown={onKey}
    >
      <rect x={room.x} y={room.y} width={room.w} height={room.h} rx={6} className={styles.roomFloor} />
      <rect x={room.x + 5} y={room.y + 5} width={room.w - 10} height={room.h - 10} rx={4} className={styles.roomInner} />
      {/* Corner brackets */}
      <path
        className={styles.roomBracket}
        d={`M${room.x} ${room.y + 18} V${room.y} H${room.x + 18} M${room.x + room.w - 18} ${room.y} H${room.x + room.w} V${room.y + 18} M${room.x + room.w} ${room.y + room.h - 18} V${room.y + room.h} H${room.x + room.w - 18} M${room.x + 18} ${room.y + room.h} H${room.x} V${room.y + room.h - 18}`}
      />

      <text x={room.x + 14} y={room.y + 22 * fs} className={styles.roomZone} style={{ fontSize: 10 * fs }}>{profile.zone}</text>
      <text x={room.x + 14} y={room.y + 42 * fs} className={styles.roomName} style={{ fontSize: 16 * fs }}>{profile.name}</text>
      <text x={room.x + room.w - 14} y={room.y + 22 * fs} className={styles.roomState} style={{ fontSize: 9 * fs }}>{toneLabel(tone)}</text>
      {earned ? (
        <text x={room.x + 14} y={room.y + 58 * fs} className={styles.roomEarned} style={{ fontSize: 7 * fs }}>
          <title>{lifetimeEarnedTitle(earned)}</title>
          EARNED {lifetimeEarnedValue(earned)}
        </text>
      ) : null}

      {equipment.map((item, index) => (
        <rect
          key={index}
          x={item.x}
          y={item.y}
          width={item.w}
          height={item.h}
          rx={1.5}
          className={item.lit ? styles.equipLit : styles.equip}
          style={item.lit ? ({ animationDelay: item.delay + "ms" } as CSSProperties) : undefined}
        />
      ))}

      {/* Desk + chair seen from above, with the agent seated */}
      <rect x={deskX - 30 * fs} y={deskY - 26 * fs} width={60 * fs} height={12 * fs} rx={2} className={styles.deskTop} />
      <rect x={deskX - 22 * fs} y={deskY - 24 * fs} width={44 * fs} height={3 * fs} className={styles.deskScreen} />
      <circle cx={deskX} cy={deskY} r={16 * fs} className={styles.agentHalo} />
      <circle cx={deskX} cy={deskY} r={11 * fs} className={styles.agentToken} />
      <text x={deskX} y={deskY + 3.6 * fs} className={styles.agentInitials} style={{ fontSize: 9.5 * fs }}>{profile.short}</text>

      {trading ? <TradingRoomTicker trading={trading} room={room} fs={fs} /> : compact ? null : (
        <text x={room.x + 14} y={room.y + room.h - 14} className={styles.roomWork} style={{ fontSize: 8.5 * fs }}>
          {fitText(agent.currentWork || profile.specialty, Math.floor((room.w - 28) / (6 * fs)))}
        </text>
      )}
    </g>
  );
}

function TradingRoomTicker({ trading, room, fs }: { trading: TradingFeed; room: Room; fs: number }) {
  const state = trading.state;
  const observer = state?.observer;
  const live = observerIsLive(state);
  const x = room.x + room.w * 0.42;
  const w = room.w * 0.52;
  const top = room.y + 58 * fs;
  const chartH = Math.max(30, room.h - 58 * fs - 70 * fs);
  const ticks = trading.ticks.slice(-120);
  let spark = "";
  if (ticks.length > 1) {
    const prices = ticks.map((tick) => tick.p);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const span = max - min || 1;
    spark = ticks
      .map((tick, index) => {
        const px = x + (index / (ticks.length - 1)) * w;
        const py = top + 20 * fs + chartH - 6 - ((tick.p - min) / span) * (chartH - 12);
        return (index === 0 ? "M" : "L") + px.toFixed(1) + " " + py.toFixed(1);
      })
      .join(" ");
  }
  const pnl = observer?.openPnl;
  return (
    <g className={styles.ticker}>
      <rect x={x - 6} y={top - 4} width={w + 12} height={chartH + 26 * fs} rx={3} className={styles.tickerScreen} />
      <text x={x} y={top + 10 * fs} className={styles.tickerHead} style={{ fontSize: 9 * fs }}>
        {live ? "●" : "○"} {observerHeadline(state)}
      </text>
      {spark ? <path d={spark} className={styles.tickerSpark} /> : (
        <text x={x} y={top + 20 * fs + chartH / 2} className={styles.tickerIdle} style={{ fontSize: 8 * fs }}>
          {live ? "WAITING FOR PRICE" : "NO LIVE FEED"}
        </text>
      )}
      <text x={x} y={top + chartH + 34 * fs} className={styles.tickerFoot} style={{ fontSize: 8.5 * fs }}>
        {price(observer?.currentPrice)} · {money(pnl)}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Desk view                                                           */
/* ------------------------------------------------------------------ */

function DeskView({
  agent,
  tasks,
  events,
  allEvents,
  floorActive,
  trading,
  earned,
  onClose,
}: {
  agent: WorkforceAgent;
  tasks: WorkforceTask[];
  events: WorkforceEvent[];
  allEvents: WorkforceEvent[];
  floorActive: boolean;
  trading: TradingFeed;
  earned: EarnedFeed;
  onClose: () => void;
}) {
  const profile = profileFor(agent);
  const Icon = profile.icon;
  const tone = toneFor(agent, floorActive);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const isTrading = agent.id === "TRADING_OBSERVER";
  const focused = isTrading && (trading.state?.observer?.status === "OPEN" || trading.state?.observer?.status === "PENDING");

  useEffect(() => {
    closeRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return createPortal(
    <div className={styles.deskOverlay} role="dialog" aria-modal="true" aria-label={`${profile.name} desk`} onClick={onClose}>
      <div
        className={styles.deskFrame + " " + styles["tone_" + tone]}
        style={{ "--agent-accent": profile.accent } as CSSProperties}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.deskHeader}>
          <div className={styles.deskIdentity}>
            <span className={styles.deskBadge}><Icon size={15} /></span>
            <div>
              <strong>{profile.name}</strong>
              <small>{profile.role} · {profile.station} · PERMISSION {agent.permissionCeiling}</small>
            </div>
          </div>
          <span className={styles.deskStatus}><i /> {toneLabel(tone)}</span>
          <button ref={closeRef} type="button" className={styles.deskClose} onClick={onClose} aria-label="Leave desk">
            <X size={16} />
          </button>
        </header>

        <div className={styles.scene}>
          <Skyline />
          <div className={styles.monitors}>
            <div className={styles.monitor + " " + styles.monitorLeft}>
              {isTrading ? <TradingSessionScreen state={trading.state} earned={earned} /> : <TaskScreen tasks={tasks} />}
            </div>
            <div className={styles.monitor + " " + styles.monitorMain}>
              {isTrading
                ? <TradingMainScreen state={trading.state} ticks={trading.ticks} failed={trading.failed} />
                : <AgentMainScreen agent={agent} tasks={tasks} profile={profile} />}
            </div>
            <div className={styles.monitor + " " + styles.monitorRight}>
              {isTrading ? <LearningScreen state={trading.state} events={allEvents} /> : <CommsScreen events={events} />}
            </div>
          </div>
          <div className={styles.deskSurface}>
            <span className={styles.keyboard} />
            <span className={styles.mouse} />
          </div>
          <Operator tone={tone} focused={focused} />
        </div>

        <footer className={styles.deskFooter}>
          <span>READ-ONLY DESK · LIVE WORKFORCE STATE{isTrading ? " + TRADING OBSERVER FEED" : ""}</span>
          <span>{isTrading ? "JARVIS NEVER PLACES ORDERS FROM THIS VIEW" : "LAST CYCLE " + timeAgo(agent.lastRanAt)}</span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function Skyline() {
  const buildings = useMemo(() => {
    const random = seededRandom(7331);
    const out: Array<{ x: number; w: number; h: number; windows: Array<{ x: number; y: number; on: boolean }> }> = [];
    let x = 0;
    while (x < 1200) {
      const w = 50 + Math.round(random() * 70);
      const h = 120 + Math.round(random() * 260);
      const windows: Array<{ x: number; y: number; on: boolean }> = [];
      for (let wy = 400 - h + 14; wy < 392; wy += 18) {
        for (let wx = x + 8; wx < x + w - 10; wx += 14) {
          if (random() < 0.32) windows.push({ x: wx, y: wy, on: random() < 0.45 });
        }
      }
      out.push({ x, w, h, windows });
      x += w + 6 + Math.round(random() * 18);
    }
    return out;
  }, []);
  return (
    <svg className={styles.skyline} viewBox="0 0 1200 400" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      {buildings.map((building) => (
        <g key={building.x}>
          <rect x={building.x} y={400 - building.h} width={building.w} height={building.h} className={styles.building} />
          {building.windows.map((win) => (
            <rect key={win.x + ":" + win.y} x={win.x} y={win.y} width={5} height={7} className={win.on ? styles.windowOn : styles.windowOff} />
          ))}
        </g>
      ))}
    </svg>
  );
}

function Operator({ tone, focused }: { tone: Tone; focused: boolean }) {
  return (
    <svg
      className={styles.operator + " " + styles["op_" + tone] + (focused ? " " + styles.opFocused : "")}
      viewBox="0 0 220 230"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="hjv-rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,74,82,.95)" />
          <stop offset="45%" stopColor="rgba(183,31,38,.35)" />
          <stop offset="100%" stopColor="rgba(183,31,38,0)" />
        </linearGradient>
      </defs>
      {/* chair back */}
      <rect x="44" y="96" width="132" height="150" rx="22" className={styles.opChair} />
      <rect x="58" y="108" width="104" height="8" rx="4" className={styles.opChairLight} />
      {/* shoulders */}
      <g className={styles.opBody}>
        <path d="M22 236 C24 168 58 138 110 136 C162 138 196 168 198 236 Z" className={styles.opTorso} />
        <path d="M22 236 C24 168 58 138 110 136 C162 138 196 168 198 236" fill="none" stroke="url(#hjv-rim)" strokeWidth="2.2" />
        <path d="M60 176 L48 214 M160 176 L172 214" className={styles.opArm} />
      </g>
      {/* head */}
      <g className={styles.opHead}>
        <rect x="96" y="112" width="28" height="26" rx="8" className={styles.opTorso} />
        <ellipse cx="110" cy="86" rx="35" ry="40" className={styles.opSkull} />
        <path d="M76 82 C78 54 96 44 110 44 C124 44 142 54 144 82" fill="none" stroke="url(#hjv-rim)" strokeWidth="2.2" />
        {/* headset */}
        <path d="M72 88 C70 46 150 46 148 88" className={styles.opHeadband} />
        <rect x="64" y="80" width="12" height="24" rx="5" className={styles.opEar} />
        <rect x="144" y="80" width="12" height="24" rx="5" className={styles.opEar} />
        <circle cx="70" cy="92" r="2.4" className={styles.opEarLight} />
        <circle cx="150" cy="92" r="2.4" className={styles.opEarLight} />
      </g>
    </svg>
  );
}

/* ----- Generic agent screens ----- */

function AgentMainScreen({ agent, tasks, profile }: { agent: WorkforceAgent; tasks: WorkforceTask[]; profile: AgentProfile }) {
  const latest = [...tasks].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null;
  return (
    <div className={styles.screen}>
      <div className={styles.screenHead}>
        <span>{profile.station.toUpperCase()} // PRIMARY</span>
        <b>{timeAgo(agent.lastRanAt)}</b>
      </div>
      <label className={styles.screenLabel}>CURRENT OUTCOME</label>
      <p className={styles.screenLead}>{agent.currentWork || profile.specialty}</p>
      <label className={styles.screenLabel}>LAST REPORTED RESULT</label>
      <p className={styles.screenText}>{agent.lastResult}</p>
      {latest ? (
        <>
          <label className={styles.screenLabel}>LATEST TASK · {latest.status}{latest.verification ? " · " + latest.verification.state : ""}</label>
          <p className={styles.screenText}><strong>{latest.title}</strong></p>
          {latest.evidence.length ? (
            <div className={styles.chips}>
              {latest.evidence.slice(0, 6).map((item) => <span key={item}>{item.slice(0, 60)}</span>)}
            </div>
          ) : <p className={styles.screenMuted}>No evidence attached to this task.</p>}
        </>
      ) : <p className={styles.screenMuted}>No task history for this agent yet.</p>}
    </div>
  );
}

function TaskScreen({ tasks }: { tasks: WorkforceTask[] }) {
  const order: Record<WorkforceTask["status"], number> = { RUNNING: 0, QUEUED: 1, WAITING_APPROVAL: 2, BLOCKED: 3, FAILED: 4, DONE: 5, CANCELLED: 6 };
  const rows = [...tasks]
    .sort((a, b) => order[a.status] - order[b.status] || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 9);
  return (
    <div className={styles.screen}>
      <div className={styles.screenHead}><span>WORK QUEUE</span><b>{tasks.length}</b></div>
      <div className={styles.list}>
        {rows.map((task) => (
          <div key={task.id} className={styles.listRow}>
            <i className={styles["task_" + task.status]} />
            <span>
              <strong>{task.title}</strong>
              <small>{task.status.replace(/_/g, " ")} · {timeAgo(task.updatedAt)}</small>
            </span>
          </div>
        ))}
        {!rows.length ? <p className={styles.screenMuted}>Nothing assigned.</p> : null}
      </div>
    </div>
  );
}

function CommsScreen({ events }: { events: WorkforceEvent[] }) {
  return (
    <div className={styles.screen}>
      <div className={styles.screenHead}><span>COMMS + HANDOFFS</span><b>{events.length}</b></div>
      <div className={styles.list}>
        {events.map((event) => (
          <div key={event.id} className={styles.logRow}>
            <b>{clock(event.occurredAt)}</b>
            <span>{quickEvent(event.summary)}</span>
          </div>
        ))}
        {!events.length ? <p className={styles.screenMuted}>No recent traffic for this desk.</p> : null}
      </div>
    </div>
  );
}

/* ----- Trading desk screens ----- */

function TradingMainScreen({ state, ticks, failed }: { state: TradingSnapshot | null; ticks: Tick[]; failed: boolean }) {
  const observer = state?.observer;
  const live = observerIsLive(state);
  const alert = state?.guardrails?.activeAlert ?? null;
  const status = observer?.intentState === "PREPARING" && observer.status !== "OPEN" ? "PREPARING" : observer?.status ?? "UNKNOWN";
  return (
    <div className={styles.screen}>
      <div className={styles.screenHead}>
        <span>{observer?.symbol ?? "NO SYMBOL"} · LIVE READ · OBSERVER</span>
        <b className={styles["status_" + status]}>{status}</b>
      </div>
      {alert ? (
        <div className={alert.severity === "VIOLATION" ? styles.alertViolation : styles.alertWarning}>
          <TriangleAlert size={12} /> <strong>{alert.title}</strong> <span>{alert.message}</span>
        </div>
      ) : null}
      <div className={styles.chartWrap}>
        <PriceChart ticks={ticks} observer={observer ?? null} />
        {!live ? (
          <div className={styles.chartOverlay}>
            <ShieldAlert size={14} />
            <span>{failed ? "TRADING STATE UNREACHABLE" : "OBSERVER OFFLINE"}</span>
            <small>LAST READ {timeAgo(state?.account.lastObservedAt ?? observer?.observedAt)}</small>
          </div>
        ) : null}
      </div>
      <div className={styles.positionStrip}>
        <div><span>SIDE</span><strong className={observer?.side === "SHORT" ? styles.short : styles.long}>{observer?.side ?? "—"}</strong></div>
        <div><span>QTY</span><strong>{observer?.quantity ?? "—"}</strong></div>
        <div><span>ENTRY</span><strong>{price(observer?.entryPrice)}</strong></div>
        <div><span>STOP</span><strong>{price(observer?.stopPrice)}</strong></div>
        <div><span>TARGET</span><strong>{price(observer?.targetPrice)}</strong></div>
        <div><span>OPEN P&amp;L</span><strong className={isNum(observer?.openPnl) && (observer?.openPnl ?? 0) < 0 ? styles.short : styles.long}>{money(observer?.openPnl)}</strong></div>
      </div>
      {observer?.readingIssue ? <p className={styles.screenMuted}>{observer.readingIssue}</p> : null}
    </div>
  );
}

function PriceChart({ ticks, observer }: { ticks: Tick[]; observer: ObserverRead | null }) {
  const W = 640;
  const H = 250;
  const padL = 8;
  const padR = 92;
  const levels = [observer?.entryPrice, observer?.stopPrice, observer?.targetPrice, observer?.currentPrice].filter(isNum);
  const prices = [...ticks.map((tick) => tick.p), ...levels];
  if (!prices.length) {
    return <div className={styles.chartEmpty}>WAITING FOR A LIVE PRICE FROM THE OBSERVER</div>;
  }
  let min = Math.min(...prices);
  let max = Math.max(...prices);
  if (max - min < 1e-9) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.12;
  min -= pad;
  max += pad;
  const y = (p: number) => H - 10 - ((p - min) / (max - min)) * (H - 20);
  const first = ticks[0]?.t ?? 0;
  const last = ticks[ticks.length - 1]?.t ?? 0;
  const x = (t: number) => (last > first ? padL + ((t - first) / (last - first)) * (W - padL - padR) : W - padR);
  const line = ticks.length > 1
    ? ticks.map((tick, index) => (index === 0 ? "M" : "L") + x(tick.t).toFixed(1) + " " + y(tick.p).toFixed(1)).join(" ")
    : "";
  const entry = observer?.entryPrice;
  const stop = observer?.stopPrice;
  const target = observer?.targetPrice;
  const current = observer?.currentPrice;
  const active = observer?.status === "OPEN" || observer?.status === "PENDING" || observer?.intentState === "PREPARING";
  const gridLines = [0.2, 0.4, 0.6, 0.8].map((f) => min + (max - min) * f);

  const pct = (value: number) => (y(value) / H) * 100 + "%";
  const tags: Array<{ key: string; value: number; label: string; className: string }> = [];
  if (isNum(target)) tags.push({ key: "tgt", value: target, label: "TGT", className: styles.targetTag });
  if (isNum(stop)) tags.push({ key: "stp", value: stop, label: "STP", className: styles.stopTag });
  if (isNum(entry)) tags.push({ key: "ent", value: entry, label: "ENT", className: styles.entryTag });
  if (isNum(current)) tags.push({ key: "px", value: current, label: "PX", className: styles.lastTag });

  return (
    <>
      <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Live price with entry, stop and target">
        {gridLines.map((value) => (
          <line key={value} x1={padL} x2={W - padR} y1={y(value)} y2={y(value)} className={styles.gridLine} />
        ))}
        {active && isNum(entry) && isNum(stop) ? (
          <rect x={padL} width={W - padL - padR} y={Math.min(y(entry), y(stop))} height={Math.abs(y(entry) - y(stop))} className={styles.riskZone} />
        ) : null}
        {active && isNum(entry) && isNum(target) ? (
          <rect x={padL} width={W - padL - padR} y={Math.min(y(entry), y(target))} height={Math.abs(y(entry) - y(target))} className={styles.rewardZone} />
        ) : null}
        {line ? <path d={line} className={styles.priceLine} /> : null}
        {isNum(target) ? <line x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} className={styles.targetLine} /> : null}
        {isNum(stop) ? <line x1={padL} x2={W - padR} y1={y(stop)} y2={y(stop)} className={styles.stopLine} /> : null}
        {isNum(entry) ? <line x1={padL} x2={W - padR} y1={y(entry)} y2={y(entry)} className={styles.entryLine} /> : null}
      </svg>
      {isNum(current) ? (
        <span
          className={styles.lastDot}
          style={{ left: ((ticks.length ? x(last) : W - padR) / W) * 100 + "%", top: pct(current) }}
        />
      ) : null}
      {tags.map((tag) => (
        <span key={tag.key} className={styles.levelTag + " " + tag.className} style={{ top: pct(tag.value) }}>
          {tag.label} {price(tag.value)}
        </span>
      ))}
    </>
  );
}

function TradingSessionScreen({ state, earned }: { state: TradingSnapshot | null; earned: EarnedFeed }) {
  const today = state?.today;
  const guard = state?.guardrails;
  const trades = [...(state?.openTrades ?? []), ...(state?.recentTrades ?? [])]
    .sort((a, b) => Date.parse(b.closedAt ?? b.openedAt) - Date.parse(a.closedAt ?? a.openedAt))
    .slice(0, 7);
  return (
    <div className={styles.screen}>
      <div className={styles.screenHead}><span>SESSION // TODAY</span><b>{state?.account.propFirm ?? state?.account.provider ?? "—"}</b></div>
      <div className={styles.earnedRow} title={lifetimeEarnedTitle(earned)}>
        <span>LIFETIME EARNED · VERIFIED PAYOUTS</span>
        <b>{lifetimeEarnedValue(earned)}</b>
      </div>
      <div className={styles.statGrid}>
        <div><span>TRADES</span><strong>{today?.trades ?? 0}</strong></div>
        <div><span>WINS</span><strong className={styles.long}>{today?.wins ?? 0}</strong></div>
        <div><span>LOSSES</span><strong className={styles.short}>{today?.losses ?? 0}</strong></div>
        <div><span>REALIZED</span><strong className={(today?.realizedPnl ?? 0) < 0 ? styles.short : styles.long}>{money(today?.realizedPnl ?? 0)}</strong></div>
      </div>
      {guard ? (
        <div className={styles.guardRow}>
          <span>RULE · {guard.todayTradeCount}/{guard.rules.maxTradesPerDay} TRADES USED</span>
          <span>RISK {guard.plannedRisk == null ? "—" : "$" + Math.round(guard.plannedRisk)} / ${guard.rules.riskTargetDollars}</span>
        </div>
      ) : null}
      <label className={styles.screenLabel}>RECENT TRADES</label>
      <div className={styles.list}>
        {trades.map((trade) => (
          <div key={trade.id} className={styles.tradeRow}>
            <b>{clock(trade.openedAt)}</b>
            <span className={trade.side === "SHORT" ? styles.short : styles.long}>{trade.side === "SHORT" ? "▼" : "▲"} {trade.quantity || ""} {trade.symbol}</span>
            <small>{price(trade.entryPrice)} → {trade.status === "OPEN" ? "OPEN" : price(trade.exitPrice)}</small>
            <strong className={(trade.realizedPnl ?? 0) < 0 ? styles.short : styles.long}>
              {trade.status === "OPEN" ? "LIVE" : trade.realizedPnl == null ? "P&L N/A" : money(trade.realizedPnl)}
            </strong>
          </div>
        ))}
        {!trades.length ? <p className={styles.screenMuted}>No observed trades yet.</p> : null}
      </div>
    </div>
  );
}

type LearningStatus = {
  ok: boolean;
  coverage?: Array<{ family: string; bars: number }>;
  trades?: { total: number };
  runs?: Array<{ id: string; status: string; outcome: string; createdAt: string; metrics?: { test?: { combined?: { recall: number } } | null } }>;
};

function LearningScreen({ state, events }: { state: TradingSnapshot | null; events: WorkforceEvent[] }) {
  const [learning, setLearning] = useState<LearningStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/learning/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: LearningStatus) => { if (!cancelled) setLearning(body); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const live = observerIsLive(state);
  const durable = state?.durableTradeCount;
  const captured = learning?.trades?.total ?? durable ?? state?.journalCount ?? 0;
  const bars = (learning?.coverage ?? []).reduce((sum, item) => sum + item.bars, 0);
  const latest = learning?.runs?.[0] ?? null;
  const shadow = learning?.runs?.find((run) => run.status === "SHADOW") ?? null;
  const firstGoal = 40;
  const reliableGoal = FIRST_CANDIDATE_TARGET;
  const goal = captured < firstGoal ? firstGoal : reliableGoal;
  const progress = Math.min(100, Math.round((captured / goal) * 100));
  const evidence = events.find((event) => event.type === "trading.indicator_evidence" || event.type === "trading.learning_run") ?? null;
  const steps: Array<{ label: string; state: "OK" | "LIVE" | "OFF" | "TODO" | "LOCKED"; note: string }> = [
    { label: "LIVE CAPTURE", state: live ? "LIVE" : "OFF", note: live ? "Observer is reading your chart" : "Local Agent not streaming" },
    durable != null
      ? { label: "DURABLE TRADE LOG", state: "OK", note: `${durable} trades saved permanently` }
      : { label: "DURABLE TRADE LOG", state: "OFF", note: "Supabase not connected: only the last 100 are kept" },
    { label: "ENTRIES LABELED", state: captured >= firstGoal ? "OK" : "TODO", note: `${captured} journaled · first candidate at ${firstGoal}` },
    { label: "MARKET BARS", state: bars > 0 ? "OK" : "TODO", note: bars > 0 ? `${bars.toLocaleString()} 1-minute bars stored` : "Add the TradingView bar feed / import CSV" },
    latest
      ? { label: "LEARNED RULES", state: latest.outcome === "CANDIDATE" ? "OK" : "TODO", note: `${latest.outcome.replace("_", " ")} · ${timeAgo(latest.createdAt)}` }
      : { label: "LEARNED RULES", state: "TODO", note: "No learning run yet" },
    shadow
      ? { label: "SHADOW SCORING", state: "LIVE", note: `${shadow.id} replayed daily` }
      : { label: "SHADOW SCORING", state: "TODO", note: "Put a candidate in shadow mode" },
    { label: "DEVIANT V1 BASELINE", state: "LOCKED", note: "Never modified; every candidate is versioned" },
  ];
  return (
    <div className={styles.screen}>
      <div className={styles.screenHead}><span>ARROW MODEL // LEARNING</span><b>{progress}%</b></div>
      <div className={styles.progress}><i style={{ width: progress + "%" }} /></div>
      <p className={styles.screenMuted}>{captured} / {goal} observed entries {captured < firstGoal ? "before the first testable DEVIANT candidate" : "toward a reliable model"}.</p>
      <div className={styles.list}>
        {steps.map((step) => (
          <div key={step.label} className={styles.stepRow}>
            <b className={styles["step_" + step.state]}>{step.state}</b>
            <span><strong>{step.label}</strong><small>{step.note}</small></span>
          </div>
        ))}
      </div>
      {evidence ? (
        <>
          <label className={styles.screenLabel}>LATEST LEARNING EVIDENCE · {timeAgo(evidence.occurredAt)}</label>
          <p className={styles.screenText}>{quickEvent(evidence.summary)}</p>
        </>
      ) : null}
      <a className={styles.labLink} href="/learning">OPEN LEARNING LAB →</a>
    </div>
  );
}
