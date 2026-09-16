"use client";

import {
  Activity,
  Bot,
  BrainCircuit,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronRight,
  Crosshair,
  Gauge,
  LifeBuoy,
  Mic,
  Radar,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ChatMessage,
  Domain,
  JarvisGoal,
  JarvisMemory,
  JarvisNextMove,
  defaultState,
  loadJarvisState,
  mergeMemories,
  saveJarvisState,
} from "../lib/jarvis-state";

type RuntimeEvent = {
  id: string;
  type: string;
  domain: string;
  importance: string;
  occurredAt: string;
  summary: string;
};

type RuntimePulse = {
  ranAt: string;
  status: "OK" | "DEGRADED" | "ERROR";
  summary: string;
  opportunities: Array<{ title: string; priority: string }>;
  nextMove: JarvisNextMove;
};

type SystemStatus = {
  online: boolean;
  mode: "ACTIVE" | "DEGRADED";
  backgroundResearch: {
    enabled: boolean;
    latestPulse: RuntimePulse | null;
  };
  events: RuntimeEvent[];
  integrations: {
    trading: string;
    finance: string;
    sentryopsResearch: string;
    life: string;
  };
};

const baseSectors = [
  {
    id: "TRADING" as const,
    icon: TrendingUp,
    title: "TRADING INTELLIGENCE",
    stat: "LEARNING",
    sub: "Recorder not connected",
    signal: "OBSERVE",
  },
  {
    id: "FINANCE" as const,
    icon: WalletCards,
    title: "FINANCE CORE",
    stat: "MAPPING",
    sub: "Financial architecture mapped; live feed pending",
    signal: "CFO",
  },
  {
    id: "SENTRYOPS" as const,
    icon: BriefcaseBusiness,
    title: "SENTRYOPS",
    stat: "RESEARCH",
    sub: "Background intelligence starting",
    signal: "BUILD",
  },
  {
    id: "LIFE" as const,
    icon: Target,
    title: "LIFE CONTROL",
    stat: "ACTIVE",
    sub: "Goals + decision support",
    signal: "ALIGN",
  },
];

const financeArchitecture = [
  { institution: "BOFA BUSINESS", role: "CAPITAL GENERATION", detail: "Business income · payouts · operating cash" },
  { institution: "CHASE", role: "PERSONAL CONTROL / DEBT ELIMINATION", detail: "Personal control · debt attack · cash routing" },
  { institution: "AMEX HYSA", role: "LIQUIDITY", detail: "Reserves · emergency cash · near-term runway" },
  { institution: "SCHWAB", role: "COMPOUNDING", detail: "Long-term investing · wealth accumulation" },
  { institution: "RBFCU", role: "LIFESTYLE", detail: "Lifestyle spending · cards · daily flexibility" },
  { institution: "BOFA PERSONAL", role: "TEMPORARY SUBSCRIPTIONS", detail: "Netflix · Prime · smart-home · temporary bills" },
];

type ApiResponse = {
  reply?: string;
  memoryUpdates?: Array<{ domain?: string; fact?: string }>;
  nextMove?: JarvisNextMove;
};

function goalTone(value: number) {
  if (value >= 70) return "goal-good";
  if (value >= 40) return "goal-watch";
  return "goal-risk";
}

export default function Home() {
  const [time, setTime] = useState("--:--:--");
  const [domain, setDomain] = useState<Domain>(defaultState.activeDomain);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(defaultState.messages);
  const [memories, setMemories] = useState<JarvisMemory[]>(defaultState.memories);
  const [goals, setGoals] = useState<JarvisGoal[]>(defaultState.goals);
  const [nextMove, setNextMove] = useState<JarvisNextMove>(defaultState.nextMove);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = loadJarvisState();
    setDomain(saved.activeDomain);
    setMessages(saved.messages);
    setMemories(saved.memories);
    setGoals(saved.goals);
    setNextMove(saved.nextMove);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveJarvisState({ version: 1, activeDomain: domain, messages, memories, goals, nextMove });
  }, [domain, goals, hydrated, memories, messages, nextMove]);

  useEffect(() => {
    const update = () => setTime(new Date().toLocaleTimeString([], { hour12: false }));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshStatus() {
      try {
        const response = await fetch("/api/system/status", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as SystemStatus;
        if (!cancelled) setSystemStatus(data);
      } catch {
        // Keep the command interface usable even when runtime status is unavailable.
      }
    }

    void refreshStatus();
    const timer = window.setInterval(refreshStatus, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const sectors = useMemo(() => {
    const sentryStatus = systemStatus?.integrations.sentryopsResearch;
    const financeStatus = systemStatus?.integrations.finance;
    const pulse = systemStatus?.backgroundResearch.latestPulse;

    return baseSectors.map((sector) => {
      if (sector.id === "FINANCE" && financeStatus === "ACTIVE") {
        return { ...sector, stat: "LIVE", sub: "Direct finance feed active" };
      }
      if (sector.id !== "SENTRYOPS") return sector;
      if (pulse?.status === "ERROR") {
        return { ...sector, stat: "DEGRADED", sub: "Research engine needs attention" };
      }
      if (sentryStatus === "ACTIVE") {
        return { ...sector, stat: "MONITORING", sub: "Background research active" };
      }
      return sector;
    });
  }, [systemStatus]);

  const currentSector = useMemo(() => sectors.find((item) => item.id === domain)!, [domain, sectors]);
  const SectorIcon = currentSector.icon;
  const runtimeEvents = systemStatus?.events ?? [];
  const latestPulse = systemStatus?.backgroundResearch.latestPulse;
  const systemMode = systemStatus?.online ? systemStatus.mode : "STARTING";

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    const userMessage: ChatMessage = { role: "user", content: text, createdAt: new Date().toISOString() };
    const nextMessages = [...messages, userMessage];

    setMessages(nextMessages);
    setInput("");
    setBusy(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
          activeDomain: domain,
          goals,
          memories: memories.map(({ domain: memoryDomain, fact }) => ({ domain: memoryDomain, fact })),
        }),
      });

      const data = (await response.json()) as ApiResponse;
      const reply = data.reply?.trim() || "No response returned from core.";

      setMessages((previous) => [
        ...previous,
        { role: "assistant", content: reply, createdAt: new Date().toISOString() },
      ]);

      if (Array.isArray(data.memoryUpdates) && data.memoryUpdates.length > 0) {
        setMemories((current) => mergeMemories(current, data.memoryUpdates ?? []));
      }

      if (data.nextMove?.title) setNextMove(data.nextMove);
    } catch {
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          content: "Connection to reasoning core failed. Interface remains operational.",
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <div className="grid-overlay" />
      <header className="topbar">
        <div className="brand-zone">
          <div className="brand-mark"><Sparkles size={18} /></div>
          <div>
            <div className="brand">J.A.R.V.I.S</div>
            <div className="micro">JUST A RATHER VERY INTELLIGENT SYSTEM</div>
          </div>
        </div>
        <div className="top-center">
          <div className="status-block"><span>SYSTEM STATUS</span><b><i /> {systemMode}</b></div>
          <div className="status-block"><span>LOCAL TIME</span><b>{time}</b></div>
        </div>
        <div className="company-zone">
          <div>
            <div className="company">HIMIE JOHNSON VENTURES</div>
            <div className="micro company-micro">DWIGHT // FOUNDER & OPERATOR</div>
          </div>
          <div className="brand-mark"><BriefcaseBusiness size={18} /></div>
        </div>
      </header>

      <section className="workspace">
        <aside className="left-column">
          <Panel eyebrow="SYSTEM //" title="MISSION CONTROL" corner="CORE">
            <div className="mission-copy">Build durable cash flow, stronger capital, scalable software, and better decisions without losing control.</div>
            <div className="mission-stat">
              <div><span>NEXT MOVE ENGINE</span><strong>ACTIVE</strong></div>
              <Gauge size={38} />
            </div>
            <div className="tiny-row"><span>Primary user</span><b>DWIGHT</b></div>
            <div className="tiny-row"><span>Current mode</span><b>{domain}</b></div>
            <div className="tiny-row"><span>Decision posture</span><b>CONTROLLED FAST</b></div>
            <div className="tiny-row"><span>Persistent memory</span><b>{memories.length} ITEMS</b></div>
            <div className="tiny-row"><span>Background monitor</span><b>{systemStatus?.backgroundResearch.enabled ? systemMode : "STARTING"}</b></div>
          </Panel>

          <Panel eyebrow="SYSTEM //" title="GOAL READINESS" corner="LIVE">
            <div className="goal-list">
              {goals.map((goal) => (
                <div className={`goal ${goalTone(goal.value)}`} key={goal.name}>
                  <div className="goal-head">
                    <span>{goal.name}</span>
                    <b>{Math.round(goal.value)}%</b>
                  </div>
                  <div className="bar" aria-label={`${goal.name} ${Math.round(goal.value)} percent complete`}>
                    <i style={{ width: `${Math.max(0, Math.min(100, goal.value))}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel eyebrow="SYSTEM //" title="EVENT STREAM" corner="RT-MONITOR">
            <div className="event-list">
              {runtimeEvents.length > 0 ? (
                runtimeEvents.slice(0, 5).map((event) => (
                  <Event key={event.id} text={event.summary} time={event.importance === "BACKGROUND" ? "BG" : event.domain.slice(0, 6)} />
                ))
              ) : (
                <>
                  <Event text="Jarvis core online" time="NOW" />
                  <Event text="Background event bus ready" time="LIVE" />
                  <Event text="Trading recorder pending" time="SETUP" />
                  <Event text="Finance architecture mapped" time="PH1" />
                </>
              )}
            </div>
          </Panel>
        </aside>

        <section className={`center-core ${domain === "FINANCE" ? "finance-mode" : ""}`}>
          {domain === "FINANCE" ? (
            <FinanceCockpit />
          ) : (
            <div className="core-visual">
              <div className="radar outer"><span className="sweep one" /><span className="sweep two" /></div>
              <div className="radar mid" />
              <div className="radar inner" />
              <div className="core-node"><BrainCircuit size={36} /><span>CORE</span><strong>{systemMode === "DEGRADED" ? "CHECK" : "ACTIVE"}</strong></div>
              <span className="axis a" /><span className="axis b" /><span className="axis c" /><span className="axis d" />
            </div>
          )}

          <div className="domain-switcher">
            {sectors.map(({ id, icon: Icon }) => (
              <button key={id} className={domain === id ? "active" : ""} onClick={() => setDomain(id)}>
                <Icon size={15} /> {id}
              </button>
            ))}
          </div>

          <div className="command-label"><Activity size={14} /> ACTIVE DOMAIN // {domain}</div>
          <form className="command-box" onSubmit={sendMessage}>
            <Mic size={18} />
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={`Talk to Jarvis about ${domain.toLowerCase()}...`}
              autoComplete="off"
            />
            <button type="submit" aria-label="Send" disabled={busy}><Send size={17} /></button>
          </form>
        </section>

        <aside className="right-column">
          <Panel eyebrow="SYSTEM //" title="DOMAIN STATUS" corner="SYNTHESIS">
            <div className="sector-feature">
              <SectorIcon />
              <div><span>{currentSector.title}</span><strong>{currentSector.stat}</strong><small>{currentSector.sub}</small></div>
            </div>
            <div className="domain-matrix">
              {sectors.map((sector) => {
                const Icon = sector.icon;
                return (
                  <button key={sector.id} onClick={() => setDomain(sector.id)} className={domain === sector.id ? "selected" : ""}>
                    <Icon size={17} /><span>{sector.id}</span><b>{sector.signal}</b>
                  </button>
                );
              })}
            </div>
            {domain === "FINANCE" && (
              <div className="approval-row"><ShieldCheck size={14} /> Phase 1 maps structure only · direct Plaid automation comes in Phase 2</div>
            )}
            {domain === "SENTRYOPS" && latestPulse && (
              <div className="approval-row"><Radar size={14} /> Last pulse: {new Date(latestPulse.ranAt).toLocaleString()} · {latestPulse.status}</div>
            )}
          </Panel>

          <Panel eyebrow="SYSTEM //" title="JARVIS LINK" corner="AI-LOG" className="chat-panel">
            <div className="chat-log">
              {messages.map((message, index) => (
                <div key={`${message.role}-${message.createdAt ?? index}-${index}`} className={`message ${message.role}`}>
                  <div className="message-meta">{message.role === "assistant" ? "JARVIS" : "DWIGHT"}</div>
                  <p>{message.content}</p>
                </div>
              ))}
              {busy && (
                <div className="message assistant thinking">
                  <div className="message-meta">JARVIS</div><p>Analyzing<span>...</span></p>
                </div>
              )}
              <div ref={endRef} />
            </div>
          </Panel>

          <Panel eyebrow="SYSTEM //" title="NEXT MOVE" corner="PRIORITY">
            <div className="next-move">
              <div className="next-icon"><Crosshair size={25} /></div>
              <div>
                <span>{nextMove.domain} PRIORITY</span>
                <strong>{nextMove.title}</strong>
                <p>{nextMove.reason}</p>
              </div>
              <ChevronRight size={18} />
            </div>
            <div className="approval-row"><CheckCircle2 size={14} /> No autonomous high-risk actions enabled</div>
          </Panel>
        </aside>
      </section>

      <footer className="footerbar">
        <span><Bot size={13} /> JARVIS CORE v0.3</span>
        <span><Radar size={13} /> OBSERVE → SYNTHESIZE → PRIORITIZE → ACT → LEARN</span>
        <span><LifeBuoy size={13} /> {systemMode === "DEGRADED" ? "MONITORING WITH LIMITATIONS" : "ALWAYS-ON EVENT MODE"}</span>
      </footer>
    </main>
  );
}

function FinanceCockpit() {
  const metrics = [
    { label: "NET WORTH", note: "Assets minus liabilities" },
    { label: "LIQUIDITY", note: "Cash + reserve accounts" },
    { label: "TOTAL DEBT", note: "Cards + future liabilities" },
    { label: "COMPOUNDING", note: "Schwab + future investments" },
  ];

  return (
    <section className="finance-cockpit">
      <div className="finance-titlebar">
        <div>
          <span>HIMIE JOHNSON VENTURES // DWIGHT</span>
          <strong>FINANCIAL COMMAND CORE</strong>
        </div>
        <div className="finance-sync"><i /> PHASE 1 · DATA SYNCING</div>
      </div>

      <div className="finance-metrics">
        {metrics.map((metric) => (
          <div className="finance-metric" key={metric.label}>
            <span>{metric.label}</span>
            <strong>SYNCING</strong>
            <small>{metric.note}</small>
          </div>
        ))}
      </div>

      <div className="cashflow-strip">
        <div><span>MONTHLY INFLOW</span><b>PENDING HISTORY</b></div>
        <div><span>MONTHLY OUTFLOW</span><b>PENDING HISTORY</b></div>
        <div><span>FREE CASH FLOW</span><b>PENDING HISTORY</b></div>
      </div>

      <div className="finance-section-head">
        <div><span>ACCOUNT ARCHITECTURE</span><strong>EVERY DOLLAR HAS A JOB</strong></div>
        <small>6 PURPOSES MAPPED</small>
      </div>

      <div className="account-role-grid">
        {financeArchitecture.map((account) => (
          <article className="account-role-card" key={account.institution}>
            <div className="account-role-top"><span>{account.institution}</span><b>MAPPED</b></div>
            <strong>{account.role}</strong>
            <p>{account.detail}</p>
          </article>
        ))}
      </div>

      <div className="finance-roadmap">
        <ShieldCheck size={15} />
        <div>
          <span>LIVE AUTOMATION PATH</span>
          <strong>PHASE 2 // DIRECT PLAID → JARVIS DATABASE → FINANCE BRAIN → NEXT MOVE</strong>
        </div>
      </div>
    </section>
  );
}

function Panel({
  eyebrow,
  title,
  corner,
  children,
  className = "",
}: {
  eyebrow: string;
  title: string;
  corner: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <span className="corner tl" /><span className="corner tr" /><span className="corner bl" /><span className="corner br" />
      <div className="panel-head"><div><span>{eyebrow}</span><strong>{title}</strong></div><small>{corner}</small></div>
      <div className="panel-rule" />
      <div className="panel-body">{children}</div>
    </section>
  );
}

function Event({ text, time }: { text: string; time: string }) {
  return <div className="event"><span>[{time}]</span><p>{text}</p><i /></div>;
}
