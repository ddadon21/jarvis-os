"use client";

import {
  Activity,
  Bot,
  BrainCircuit,
  BriefcaseBusiness,
  LifeBuoy,
  Mic,
  Radar,
  Send,
  Sparkles,
  Target,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import DomainGoals from "./domain-goals";
import FinanceCockpitV2 from "./finance-cockpit-v2";
import TradingCockpit from "./trading-cockpit";
import LifeCockpit from "./life-cockpit";
import lifeStyles from "./life-cockpit.module.css";
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
  domain: "TRADING" | "FINANCE" | "SENTRYOPS" | "LIFE" | "CORE";
  importance: string;
  occurredAt: string;
  summary: string;
};

type SystemStatus = {
  online: boolean;
  mode: "ACTIVE" | "DEGRADED";
  backgroundResearch: { enabled: boolean; latestPulse: { ranAt: string; status: string; summary: string } | null };
  events: RuntimeEvent[];
  integrations: { trading: string; finance: string; sentryopsResearch: string; life: string };
  workforce?: { status?: string; lastCycleAt?: string | null; executiveSummary?: string };
};

type ApiResponse = {
  reply?: string;
  memoryUpdates?: Array<{ domain?: string; fact?: string }>;
  nextMove?: JarvisNextMove;
  brain?: "CLAUDE" | "GPT" | "DUAL";
  model?: string | null;
  provider?: string | null;
};

const sectors = [
  { id: "TRADING" as const, icon: TrendingUp, title: "TRADING", signal: "PASS → PAYOUT" },
  { id: "FINANCE" as const, icon: WalletCards, title: "FINANCE", signal: "$100M CASH" },
  { id: "SENTRYOPS" as const, icon: BriefcaseBusiness, title: "SENTRYOPS", signal: "BUILD → CUSTOMER" },
  { id: "LIFE" as const, icon: Target, title: "LIFE", signal: "ALIGN" },
];

export default function WorkV2() {
  const [time, setTime] = useState("--:--:--");
  const [date, setDate] = useState("--- -- ----");
  const [domain, setDomain] = useState<Domain>(defaultState.activeDomain);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(defaultState.messages);
  const [memories, setMemories] = useState<JarvisMemory[]>(defaultState.memories);
  const [goals, setGoals] = useState<JarvisGoal[]>(defaultState.goals);
  const [nextMove, setNextMove] = useState<JarvisNextMove>(defaultState.nextMove);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [activeProvider, setActiveProvider] = useState("AUTO");
  const [activeModel, setActiveModel] = useState("JARVIS CORE");
  const endRef = useRef<HTMLDivElement>(null);

  function hydrateFromState() {
    const saved = loadJarvisState();
    setDomain(saved.activeDomain);
    setMessages(saved.messages);
    setMemories(saved.memories);
    setGoals(saved.goals);
    setNextMove(saved.nextMove);
  }

  useEffect(() => {
    hydrateFromState();
    setHydrated(true);
    const refresh = () => hydrateFromState();
    window.addEventListener("jarvis-state-updated", refresh);
    return () => window.removeEventListener("jarvis-state-updated", refresh);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveJarvisState({ version: 1, activeDomain: domain, messages, memories, goals, nextMove });
  }, [domain, goals, hydrated, memories, messages, nextMove]);

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString([], { hour12: false }));
      setDate(now.toLocaleDateString([], { month: "short", day: "2-digit", year: "numeric" }).toUpperCase());
    };
    updateClock();
    const timer = window.setInterval(updateClock, 1000);
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
      } catch {}
    }
    void refreshStatus();
    const timer = window.setInterval(refreshStatus, 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  const currentSector = useMemo(() => sectors.find((item) => item.id === domain) ?? sectors[0], [domain]);
  const SectorIcon = currentSector.icon;
  const runtimeEvents = systemStatus?.events ?? [];
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
          brain: "auto",
        }),
      });
      const data = (await response.json()) as ApiResponse;
      const reply = data.reply?.trim() || "No response returned from core.";
      if (data.provider) setActiveProvider(data.provider);
      if (data.model) setActiveModel(data.model);
      setMessages((previous) => [...previous, { role: "assistant", content: reply, createdAt: new Date().toISOString() }]);
      if (Array.isArray(data.memoryUpdates) && data.memoryUpdates.length > 0) setMemories((current) => mergeMemories(current, data.memoryUpdates ?? []));
      if (data.nextMove?.title) setNextMove(data.nextMove);
    } catch {
      setMessages((previous) => [...previous, { role: "assistant", content: "Core link unavailable. Jarvis will retain state and retry when the reasoning link is healthy.", createdAt: new Date().toISOString() }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={`shell ${domain === "LIFE" ? lifeStyles.shell : ""}`}>
      <div className="grid-overlay" />
      <header className="topbar">
        <div className="brand-zone">
          <div className="brand-mark"><Sparkles size={18} /></div>
          <div><div className="brand">J.A.R.V.I.S</div><div className="micro">JUST A RATHER VERY INTELLIGENT SYSTEM</div></div>
        </div>
        <div className="top-center">
          <div className="status-block"><span>SYSTEM STATUS</span><b><i /> {systemMode}</b></div>
          <div className="status-block"><span>LOCAL DATE</span><b>{date}</b></div>
          <div className="status-block"><span>LOCAL TIME</span><b>{time}</b></div>
        </div>
        <div className="company-zone"><div><div className="company">HIMIE JOHNSON VENTURES</div><div className="micro company-micro">DWIGHT // FOUNDER & OPERATOR</div></div><div className="brand-mark"><BriefcaseBusiness size={18} /></div></div>
      </header>

      <section className="workspace">
        <div style={{ position: "absolute", top: 13, left: 300, right: 300, zIndex: 8, textAlign: "center", background: "rgba(2,8,13,.96)", padding: "5px 14px", color: "#f1f1f1", fontSize: ".68rem", letterSpacing: ".08em" }}>
          BUILD DURABLE CASH FLOW, STRONGER CAPITAL, SCALABLE SOFTWARE, AND BETTER DECISIONS WITHOUT LOSING CONTROL.
        </div>

        <aside className="left-column">
          <Panel title="MISSION CONTROL" corner="CORE"><div /></Panel>
          <Panel title={domain === "LIFE" ? "DAILY FOUNDATIONS" : "GOAL READINESS"} corner={domain}>
            <DomainGoals domain={domain} events={runtimeEvents} />
          </Panel>
          <Panel title="EVENTS" corner="LIVE">
            <div className="event-list">
              {runtimeEvents.length > 0 ? runtimeEvents.slice(0, 5).map((event) => (
                <Event key={event.id} text={event.summary} time={event.importance === "BACKGROUND" ? "BG" : event.domain.slice(0, 6)} />
              )) : <><Event text="Jarvis core online" time="NOW" /><Event text="Autonomous workforce ready" time="AI" /><Event text="Finance accounts connected" time="FIN" /></>}
            </div>
          </Panel>
        </aside>

        <section className={`center-core ${domain === "FINANCE" ? "finance-mode" : ""} ${domain === "TRADING" ? "trading-mode" : ""} ${domain === "LIFE" ? lifeStyles.center : ""}`}>
          {domain === "FINANCE" ? <FinanceCockpitV2 /> : domain === "TRADING" ? <TradingCockpit /> : domain === "LIFE" ? <LifeCockpit /> : (
            <div className="core-visual">
              <div className="radar outer"><span className="sweep one" /><span className="sweep two" /></div>
              <div className="radar mid" /><div className="radar inner" />
              <div className="core-node"><BrainCircuit size={36} /><span>CORE</span><strong>{systemMode}</strong></div>
              <span className="axis a" /><span className="axis b" /><span className="axis c" /><span className="axis d" />
            </div>
          )}

          <div className="domain-switcher">
            {sectors.map(({ id, icon: Icon }) => <button key={id} className={domain === id ? "active" : ""} onClick={() => setDomain(id)}><Icon size={15} /> {id}</button>)}
          </div>

          <div className="command-label"><Activity size={14} /> {domain} // JARVIS WORKING</div>
          <form className="command-box" onSubmit={sendMessage}>
            <Mic size={18} />
            <input value={input} onChange={(event) => setInput(event.target.value)} placeholder={`Tell Jarvis what matters in ${domain.toLowerCase()}...`} autoComplete="off" />
            <button type="submit" aria-label="Send" disabled={busy}><Send size={17} /></button>
          </form>
        </section>

        <aside className="right-column">
          <Panel title="JARVIS" corner={systemMode} className="jarvis-presence-panel">
            <div className="jarvis-presence">
              <div className="jarvis-presence-orb" aria-label="Jarvis core presence">
                <span className="jarvis-presence-ring outer" />
                <span className="jarvis-presence-ring inner" />
                <span className="jarvis-presence-core">J</span>
              </div>
              <div className="jarvis-presence-copy">
                <strong>{busy ? "THINKING" : "ONLINE"}</strong>
                <span>{domain} MODE</span>
                <small>{activeProvider} · {activeModel}</small>
              </div>
            </div>
          </Panel>

          <Panel title="JARVIS LINK" corner={activeProvider} className="chat-panel">
            <div className="brain-runtime"><span>CORE</span><strong>{activeProvider}</strong><small>{activeModel}</small></div>
            <div className="chat-log" style={{ height: 210 }}>
              {messages.slice(-6).map((message, index) => <div key={`${message.role}-${message.createdAt ?? index}`} className={`message ${message.role}`}><div className="message-meta">{message.role === "assistant" ? "JARVIS" : "DWIGHT"}</div><p>{message.content}</p></div>)}
              {busy && <div className="message assistant thinking"><div className="message-meta">JARVIS</div><p>Working<span>...</span></p></div>}
              <div ref={endRef} />
            </div>
          </Panel>

          <Panel title="DOMAIN" corner={currentSector.signal}>
            <div className="sector-feature"><SectorIcon /><div><span>{currentSector.title}</span><strong>{currentSector.signal}</strong><small>{domain === "FINANCE" ? "CFO watches money, debt, credit, capital and lifestyle readiness." : domain === "TRADING" ? "Pass → funded → payout → consistency → scale." : domain === "SENTRYOPS" ? "Prototype → pilot → first customer → repeatable sales." : "Daily alignment with the larger plan."}</small></div></div>
          </Panel>
        </aside>
      </section>
    </main>
  );
}

function Panel({ title, corner, children, className = "" }: { title: string; corner: string; children: React.ReactNode; className?: string }) {
  return <section className={`panel ${className}`}><span className="corner tl" /><span className="corner tr" /><span className="corner bl" /><span className="corner br" /><div className="panel-head"><div><strong>{title}</strong></div><small>{corner}</small></div><div className="panel-rule" /><div className="panel-body">{children}</div></section>;
}

function Event({ text, time }: { text: string; time: string }) {
  return <div className="event"><span>[{time}]</span><p>{text}</p><i /></div>;
}
