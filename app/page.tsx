"use client";

import {
  Activity,
  Bell,
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
  UserRound,
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

const sectors = [
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
    stat: "SETUP",
    sub: "Accounts not connected",
    signal: "CFO",
  },
  {
    id: "SENTRYOPS" as const,
    icon: BriefcaseBusiness,
    title: "SENTRYOPS",
    stat: "RESEARCH",
    sub: "Market intelligence ready",
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

type ApiResponse = {
  reply?: string;
  memoryUpdates?: Array<{ domain?: string; fact?: string }>;
  nextMove?: JarvisNextMove;
};

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
    saveJarvisState({
      version: 1,
      activeDomain: domain,
      messages,
      memories,
      goals,
      nextMove,
    });
  }, [domain, goals, hydrated, memories, messages, nextMove]);

  useEffect(() => {
    const update = () => setTime(new Date().toLocaleTimeString([], { hour12: false }));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const currentSector = useMemo(() => sectors.find((item) => item.id === domain)!, [domain]);
  const SectorIcon = currentSector.icon;

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
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

      if (data.nextMove?.title) {
        setNextMove(data.nextMove);
      }
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
          <div className="status-block"><span>SYSTEM STATUS</span><b><i /> OPTIMAL</b></div>
          <div className="status-block"><span>LOCAL TIME</span><b>{time}</b></div>
        </div>
        <div className="top-actions">
          <Bell size={17} />
          <ShieldCheck size={17} />
          <div className="profile-chip"><UserRound size={15} /> <span>OPERATOR</span><i /></div>
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
            <div className="tiny-row"><span>Current mode</span><b>{domain}</b></div>
            <div className="tiny-row"><span>Decision posture</span><b>CONTROLLED FAST</b></div>
            <div className="tiny-row"><span>Persistent memory</span><b>{memories.length} ITEMS</b></div>
          </Panel>

          <Panel eyebrow="SYSTEM //" title="GOAL READINESS" corner="LIVE">
            <div className="goal-list">
              {goals.map((goal) => (
                <div className="goal" key={goal.name}>
                  <div className="goal-head"><span>{goal.name}</span><b>{goal.state}</b></div>
                  <div className="bar"><i style={{ width: `${goal.value}%` }} /></div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel eyebrow="SYSTEM //" title="EVENT STREAM" corner="RT-MONITOR">
            <div className="event-list">
              <Event text="Jarvis core online" time="NOW" />
              <Event text="Reasoning link provisioned" time="LIVE" />
              <Event text="Device memory active" time="LIVE" />
              <Event text="Trading recorder pending" time="SETUP" />
              <Event text="Secure finance persistence pending" time="SETUP" />
            </div>
          </Panel>
        </aside>

        <section className="center-core">
          <div className="core-visual">
            <div className="radar outer"><span className="sweep one" /><span className="sweep two" /></div>
            <div className="radar mid" />
            <div className="radar inner" />
            <div className="core-node"><BrainCircuit size={36} /><span>CORE</span><strong>ACTIVE</strong></div>
            <span className="axis a" /><span className="axis b" /><span className="axis c" /><span className="axis d" />
          </div>

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
          </Panel>

          <Panel eyebrow="SYSTEM //" title="JARVIS LINK" corner="AI-LOG" className="chat-panel">
            <div className="chat-log">
              {messages.map((message, index) => (
                <div key={`${message.role}-${message.createdAt ?? index}-${index}`} className={`message ${message.role}`}>
                  <div className="message-meta">{message.role === "assistant" ? "JARVIS" : "YOU"}</div>
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
        <span><Bot size={13} /> JARVIS CORE v0.2</span>
        <span><Radar size={13} /> OBSERVE → SYNTHESIZE → PRIORITIZE → ACT → LEARN</span>
        <span><LifeBuoy size={13} /> SECURE FOUNDATION MODE</span>
      </footer>
    </main>
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
