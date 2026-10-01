"use client";

import {
  Activity,
   BriefcaseBusiness,
   Mic,
   Send,
   Target,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { FormEvent, memo, useEffect, useMemo, useRef, useState } from "react";
import DomainGoals from "./domain-goals";
import DwightTradingRules from "./dwight-trading-rules";
import ObsidianBridgePanel from "./obsidian-bridge-panel";
import FinanceCockpitV2 from "./finance-cockpit-v2";
import TradingCockpit from "./trading-cockpit";
import LifeCockpit, { LifeProgress } from "./life-cockpit";
import lifeStyles from "./life-cockpit.module.css";
import { useJarvisVoice } from "./jarvis-voice";
import WorkforcePanel from "./workforce-panel";
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
import { tryExecuteDesktopText } from "../lib/jarvis-desktop-client";
import JarvisPresence from "./jarvis-presence";
import JarvisLocalClock from "./jarvis-local-clock";

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
  integrations: {
    trading: string;
    finance: string;
    sentryopsResearch: string;
    life: string;
    calendar?: string;
    email?: string;
    meetings?: string;
    contacts?: string;
    webSearch?: string;
  };
  assistant?: {
    updatedAt?: string;
    sources?: {
      calendar?: string;
      email?: string;
      meetings?: string;
      contacts?: string;
      webSearch?: string;
    };
    alerts?: Array<{
      id: string;
      kind: string;
      priority: string;
      message: string;
      occurredAt: string;
      relatedEventId?: string | null;
    }>;
    upcomingEventCount?: number;
    meetingPresenceCount?: number;
    recentCommunicationCount?: number;
  };
  workforce?: { status?: string; lastCycleAt?: string | null; executiveSummary?: string };
};

type AssistantPulse = {
  updatedAt?: string;
  sources?: {
    calendar?: string;
    email?: string;
    meetings?: string;
    contacts?: string;
    webSearch?: string;
  };
  alerts?: Array<{
    id: string;
    kind: string;
    priority: string;
    message: string;
    occurredAt: string;
    relatedEventId?: string | null;
  }>;
  counts?: {
    upcomingEvents?: number;
    meetingPresence?: number;
    recentCommunications?: number;
  };
};

type StreamMeta = {
  route?: "FAST" | "STANDARD" | "DEEP";
  provider?: string;
  brain?: string;
  model?: string;
  fallback?: boolean;
  text?: string;
  memoryUpdates?: Array<{ domain?: string; fact?: string }>;
  nextMove?: JarvisNextMove;
  firstTokenMs?: number | null;
  totalMs?: number | null;
  message?: string;
};

const StableFinanceCockpit = memo(FinanceCockpitV2);
const StableTradingCockpit = memo(TradingCockpit);
const StableLifeCockpit = memo(LifeCockpit);
const StableWorkforcePanel = memo(WorkforcePanel);
const StableObsidianBridgePanel = memo(ObsidianBridgePanel);

const sectors = [
  { id: "TRADING" as const, icon: TrendingUp, title: "TRADING", signal: "PASS → PAYOUT" },
  { id: "FINANCE" as const, icon: WalletCards, title: "FINANCE", signal: "$100M CASH" },
  { id: "SENTRYOPS" as const, icon: BriefcaseBusiness, title: "SENTRYOPS", signal: "BUILD → CUSTOMER" },
  { id: "LIFE" as const, icon: Target, title: "LIFE", signal: "ALIGN" },
];

function quickCoreEvent(summary: string) {
  const compact = summary.replace(/\s+/g, " ").trim();
  const first = compact.split(/(?<=[.!?])\s+/)[0] || compact;
  return first.length > 88 ? first.slice(0, 85).trimEnd() + "…" : first;
}

export default function WorkV2() {
  const { voiceEnabled, voiceState, caption, toggleVoice } = useJarvisVoice();
  const [domain, setDomain] = useState<Domain>(defaultState.activeDomain);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(defaultState.messages);
  const [memories, setMemories] = useState<JarvisMemory[]>(defaultState.memories);
  const [goals, setGoals] = useState<JarvisGoal[]>(defaultState.goals);
  const [nextMove, setNextMove] = useState<JarvisNextMove>(defaultState.nextMove);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [assistantPulse, setAssistantPulse] = useState<AssistantPulse | null>(null);
  const spokenAssistantAlertsRef = useRef<Set<string>>(new Set());
  const [activeProvider, setActiveProvider] = useState("AUTO");
  const [activeModel, setActiveModel] = useState("JARVIS CORE");
  const [activeRoute, setActiveRoute] = useState<"IDLE" | "FAST" | "STANDARD" | "DEEP">("IDLE");
  const [firstTokenMs, setFirstTokenMs] = useState<number | null>(null);
  const [responseMs, setResponseMs] = useState<number | null>(null);
  const [streamStarted, setStreamStarted] = useState(false);
  const systemStatusSignatureRef = useRef("");
  const assistantSignatureRef = useRef("");

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
    const timer = window.setTimeout(() => {
      saveJarvisState({ version: 1, activeDomain: domain, messages, memories, goals, nextMove });
    }, busy ? 650 : 180);
    return () => window.clearTimeout(timer);
  }, [busy, domain, goals, hydrated, memories, messages, nextMove]);

  useEffect(() => {
    let cancelled = false;
    async function refreshStatus() {
      try {
        const response = await fetch("/api/system/status", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as SystemStatus;
        const signature = JSON.stringify({
          online: data.online,
          mode: data.mode,
          integrations: data.integrations,
          events: data.events,
          workforce: data.workforce,
        });
        if (!cancelled && signature !== systemStatusSignatureRef.current) {
          systemStatusSignatureRef.current = signature;
          setSystemStatus(data);
        }
      } catch {}
    }
    void refreshStatus();
    const timer = window.setInterval(refreshStatus, 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function refreshAssistant() {
      try {
        const response = await fetch("/api/assistant/alerts", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as AssistantPulse;
        const signature = JSON.stringify({
          sources: data.sources,
          alerts: data.alerts,
          counts: data.counts,
        });
        if (!cancelled && signature !== assistantSignatureRef.current) {
          assistantSignatureRef.current = signature;
          setAssistantPulse(data);
        }
      } catch {}
    }
    void refreshAssistant();
    const timer = window.setInterval(refreshAssistant, 10_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);


  useEffect(() => {
    if (!voiceEnabled) return;
    const alerts = assistantPulse?.alerts ?? [];
    const urgent = alerts.find(alert => alert.priority === "CRITICAL" || alert.priority === "TIME_SENSITIVE");
    if (!urgent) return;

    const key = urgent.id + ":" + urgent.occurredAt;
    if (spokenAssistantAlertsRef.current.has(key)) return;
    spokenAssistantAlertsRef.current.add(key);

    window.dispatchEvent(new CustomEvent("jarvis-proactive-speak", {
      detail: { text: urgent.message, priority: urgent.priority },
    }));
  }, [assistantPulse, voiceEnabled]);

  const currentSector = useMemo(() => sectors.find((item) => item.id === domain) ?? sectors[0], [domain]);
  const SectorIcon = currentSector.icon;
  const jarvisVisualState = busy ? "THINKING" : voiceEnabled ? voiceState : "STANDBY";
  const runtimeEvents = systemStatus?.events ?? [];
  const systemMode = systemStatus?.online ? systemStatus.mode : "STARTING";
  const assistantState = assistantPulse ?? systemStatus?.assistant ?? null;

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    const userMessage: ChatMessage = { role: "user", content: text, createdAt: new Date().toISOString() };
    const nextMessages = [...messages, userMessage];
    const assistantStamp = new Date(Date.now() + 1).toISOString();
    let assistantStarted = false;

    setMessages(nextMessages);
    setInput("");
    setBusy(true);
    setStreamStarted(false);
    setFirstTokenMs(null);
    setResponseMs(null);

    const desktopStartedAt = performance.now();
    try {
      const desktop = await tryExecuteDesktopText(text);
      if (desktop) {
        const elapsed = Math.max(1, Math.round(performance.now() - desktopStartedAt));
        setActiveProvider("WINDOWS LOCAL AGENT");
        setActiveModel("DESKTOP RUNTIME");
        setActiveRoute("FAST");
        setFirstTokenMs(elapsed);
        setResponseMs(elapsed);
        setStreamStarted(true);
        setMessages((previous) => [
          ...previous,
          { role: "assistant", content: desktop.message, createdAt: assistantStamp },
        ]);
        window.dispatchEvent(new CustomEvent("jarvis-obsidian-sync-now"));
        setBusy(false);
        window.setTimeout(() => setStreamStarted(false), 120);
        return;
      }
    } catch {
      // If a local action path fails before producing a structured result,
      // fall through to other connected tools and normal Jarvis reasoning.
    }

    const applyEvent = (eventName: string, payload: StreamMeta) => {
      if (eventName === "meta") {
        if (payload.provider) setActiveProvider(payload.provider);
        if (payload.model) setActiveModel(payload.model);
        if (payload.route === "FAST" || payload.route === "STANDARD" || payload.route === "DEEP") setActiveRoute(payload.route);
        return;
      }

      if (eventName === "delta" && typeof payload.text === "string" && payload.text) {
        const piece = payload.text;
        if (!assistantStarted) {
          assistantStarted = true;
          setStreamStarted(true);
          setMessages((previous) => [...previous, { role: "assistant", content: piece, createdAt: assistantStamp }]);
        } else {
          setMessages((previous) => previous.map((message) =>
            message.createdAt === assistantStamp ? { ...message, content: message.content + piece } : message
          ));
        }
        return;
      }

      if (eventName === "final") {
        if (payload.provider) setActiveProvider(payload.provider);
        if (payload.model) setActiveModel(payload.model);
        if (payload.route === "FAST" || payload.route === "STANDARD" || payload.route === "DEEP") setActiveRoute(payload.route);
        if (typeof payload.firstTokenMs === "number") setFirstTokenMs(payload.firstTokenMs);
        if (typeof payload.totalMs === "number") setResponseMs(payload.totalMs);
        if (Array.isArray(payload.memoryUpdates) && payload.memoryUpdates.length > 0) {
          setMemories((current) => mergeMemories(current, payload.memoryUpdates ?? []));
        }
        if (payload.nextMove?.title) setNextMove(payload.nextMove);
        window.dispatchEvent(new CustomEvent("jarvis-obsidian-sync-now"));
        return;
      }

      if (eventName === "error" && !assistantStarted) {
        assistantStarted = true;
        const message = payload.message?.trim() || "Core link unavailable. Jarvis will retain state and retry when the reasoning link is healthy.";
        setMessages((previous) => [...previous, { role: "assistant", content: message, createdAt: assistantStamp }]);
      }
    };

    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
          activeDomain: domain,
          goals,
          memories: memories.map(({ domain: memoryDomain, fact }) => ({ domain: memoryDomain, fact })),
        }),
      });

      if (!response.ok || !response.body) throw new Error("Streaming core unavailable.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);

          let eventName = "message";
          let data = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim();
            if (line.startsWith("data:")) data += line.slice(5).trim();
          }

          if (data) {
            try { applyEvent(eventName, JSON.parse(data) as StreamMeta); } catch {}
          }
          boundary = buffer.indexOf("\n\n");
        }
      }

      if (!assistantStarted) {
        setMessages((previous) => [...previous, { role: "assistant", content: "JARVIS completed the request but no response text was returned.", createdAt: assistantStamp }]);
      }
    } catch {
      if (!assistantStarted) {
        setMessages((previous) => [...previous, { role: "assistant", content: "Core link unavailable. Jarvis will retain state and retry when the reasoning link is healthy.", createdAt: assistantStamp }]);
      }
    } finally {
      setBusy(false);
      setStreamStarted(false);
    }
  }

  return (
    <main className={`shell ${domain === "LIFE" ? lifeStyles.shell : ""}`}>
      <div className="grid-overlay" />
      <header className="topbar">
        <div className="brand-zone">
          <div className="brand-mark jarvis-brand-presence"><JarvisPresence state={jarvisVisualState} variant="mini" label="JARVIS" /></div>
          <div><div className="brand">J.A.R.V.I.S</div><div className="micro">JUST A RATHER VERY INTELLIGENT SYSTEM</div></div>
        </div>
        <div className="top-center">
          <div className="status-block"><span>SYSTEM STATUS</span><b><i /> {systemMode}</b></div>
          <JarvisLocalClock variant="topbar" />
        </div>
        <div className="company-zone"><div><div className="company">HIMIE JOHNSON VENTURES</div><div className="micro company-micro">DWIGHT // FOUNDER & OPERATOR</div></div><div className="brand-mark"><BriefcaseBusiness size={18} /></div></div>
      </header>

      <section className="workspace">
        <div className="workspace-memo">
          <strong>WAIT FOR SOMEONE TO LOSE</strong>
          <span>BUILD DURABLE CASH FLOW, STRONGER CAPITAL, SCALABLE SOFTWARE, AND BETTER DECISIONS WITHOUT LOSING CONTROL.</span>
        </div>

        <aside className="left-column">
          <Panel title="MISSION CONTROL" corner="CORE">
            <div className="assistant-radar">
              {assistantState?.alerts?.[0] ? (
                <div className={`assistant-alert ${assistantState!.alerts![0].priority.toLowerCase()}`}>
                  <span>{assistantState!.alerts![0].priority}</span>
                  <p>{assistantState!.alerts![0].message}</p>
                </div>
              ) : (
                <div className="assistant-alert quiet"><span>RADAR</span><p>NO TIME-SENSITIVE ALERTS</p></div>
              )}
              <div className="assistant-source-grid">
                <AssistantSource label="CORE" state={systemMode} />
                <AssistantSource label="WORK" state={systemStatus?.workforce?.status ?? "STARTING"} />
                <AssistantSource label="TRADE" state={systemStatus?.integrations?.trading ?? "STARTING"} />
                <AssistantSource label="FIN" state={systemStatus?.integrations?.finance ?? "STARTING"} />
              </div>
            </div>
          </Panel>
          <Panel title={domain === "LIFE" ? "DEVELOPMENT" : "GOAL READINESS"} corner={domain}>
            {domain === "LIFE" ? <><LifeProgress /><details className={lifeStyles.foundations}><summary>DAILY FOUNDATIONS</summary><DomainGoals domain={domain} events={runtimeEvents} /></details></> : <DomainGoals domain={domain} events={runtimeEvents} />}
          </Panel>
          <Panel title="OBSIDIAN" corner="LOCAL">
            <StableObsidianBridgePanel />
          </Panel>
          {domain === "TRADING" ? (
            <Panel title="" corner="" className="trading-rules-panel">
              <DwightTradingRules />
            </Panel>
          ) : null}
        </aside>

        <section className={`center-core ${domain === "FINANCE" ? "finance-mode" : ""} ${domain === "TRADING" ? "trading-mode" : ""} ${domain === "LIFE" ? lifeStyles.center : ""}`}>
          {domain === "FINANCE" ? <StableFinanceCockpit /> : domain === "TRADING" ? <StableTradingCockpit /> : domain === "LIFE" ? <StableLifeCockpit /> : (
            <div className="core-visual jarvis-living-core">
              <JarvisPresence state={jarvisVisualState} variant="hero" label="JARVIS" />
              <div className="jarvis-core-readout">
                <span>JARVIS CORE</span>
                <strong>{busy ? "THINKING" : voiceEnabled ? voiceState : systemMode}</strong>
              </div>
            </div>
          )}

          <div className="domain-switcher">
            {sectors.map(({ id, icon: Icon }) => <button key={id} className={domain === id ? "active" : ""} onClick={() => setDomain(id)}><Icon size={15} /> {id}</button>)}
          </div>

          <div className="command-label"><Activity size={14} /> {domain} // JARVIS WORKING</div>
          <form className="command-box" onSubmit={sendMessage}>
            <button
              type="button"
              className={voiceEnabled ? "command-mic active" : "command-mic"}
              aria-label={voiceEnabled ? "Turn Jarvis voice off" : "Start Jarvis realtime voice"}
              title={voiceEnabled ? caption : "Start realtime voice"}
              onClick={toggleVoice}
            >
              <Mic size={18} />
            </button>
            <input value={input} onChange={(event) => setInput(event.target.value)} placeholder={voiceEnabled ? `${voiceState} · ${caption}` : `Tell Jarvis what matters in ${domain.toLowerCase()}...`} autoComplete="off" />
            <button type="submit" aria-label="Send" disabled={busy}><Send size={17} /></button>
          </form>
        </section>

        <aside className="right-column">
          <div className="jarvis-right-orb" aria-label="Jarvis presence">
            <JarvisPresence state={jarvisVisualState} variant="core" label="JARVIS" />
          </div>

          <Panel title="EVENTS" corner="BRIEF" className="core-events-panel">
            <div className="event-list core-event-list">
              {runtimeEvents.length > 0 ? runtimeEvents.slice(0, 7).map((event) => (
                <Event
                  key={event.id}
                  text={quickCoreEvent(event.summary)}
                  time={event.importance === "BACKGROUND" ? "BG" : event.domain.slice(0, 6)}
                />
              )) : <>
                <Event text="Jarvis core online" time="NOW" />
                <Event text="Autonomous workforce ready" time="AI" />
                <Event text="Finance state connected" time="FIN" />
              </>}
            </div>
          </Panel>

          <Panel title="AI WORKFORCE" corner={systemStatus?.workforce?.status ?? "STARTING"} className="core-workforce-panel">
            <StableWorkforcePanel />
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

function AssistantSource({ label, state }: { label: string; state: string }) {
  const normalized = state.toLowerCase().replace(/_/g, "-");
  const compact = state === "NEEDS_CONNECTION" ? "CONNECT" : state;
  return <div className={`assistant-source ${normalized}`}><span>{label}</span><strong>{compact}</strong></div>;
}
