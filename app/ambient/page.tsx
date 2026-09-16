"use client";

import { useEffect, useRef, useState } from "react";
import { loadJarvisState, mergeMemories, saveJarvisState } from "../../lib/jarvis-state";
import "./ambient.css";

type VoiceState = "STANDBY" | "LISTENING" | "THINKING" | "SPEAKING" | "ERROR";

type ApiResponse = {
  reply?: string;
  memoryUpdates?: Array<{ domain?: string; fact?: string }>;
  nextMove?: { title: string; reason: string; domain: "TRADING" | "FINANCE" | "SENTRYOPS" | "LIFE" | "CORE" };
};

export default function AmbientPage() {
  const [time, setTime] = useState("--:--");
  const [date, setDate] = useState("--- --, ----");
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>("STANDBY");
  const [caption, setCaption] = useState("Say “Jarvis” or “Hey Jarvis”");
  const recognitionRef = useRef<any>(null);
  const voiceEnabledRef = useRef(false);
  const armedRef = useRef(false);
  const speakingRef = useRef(false);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }));
      setDate(now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" }).toUpperCase());
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      voiceEnabledRef.current = false;
      recognitionRef.current?.stop?.();
      window.speechSynthesis?.cancel();
    };
  }, []);

  function restartRecognitionSoon() {
    if (!voiceEnabledRef.current || speakingRef.current) return;
    window.setTimeout(() => {
      if (!voiceEnabledRef.current || speakingRef.current) return;
      try {
        recognitionRef.current?.start?.();
      } catch {
        // Browser may already be listening.
      }
    }, 250);
  }

  async function askJarvis(command: string) {
    const clean = command.trim();
    if (!clean) return;

    armedRef.current = false;
    setVoiceState("THINKING");
    setCaption(clean);

    const state = loadJarvisState();
    const userMessage = { role: "user" as const, content: clean, createdAt: new Date().toISOString() };
    const nextMessages = [...state.messages, userMessage].slice(-80);
    saveJarvisState({ ...state, messages: nextMessages });

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
          activeDomain: state.activeDomain,
          goals: state.goals,
          memories: state.memories.map(({ domain, fact }) => ({ domain, fact })),
          brain: "auto",
        }),
      });

      const data = (await response.json()) as ApiResponse;
      const reply = data.reply?.trim() || "I did not receive a usable response.";
      const updatedMemories = Array.isArray(data.memoryUpdates) ? mergeMemories(state.memories, data.memoryUpdates) : state.memories;
      const assistantMessage = { role: "assistant" as const, content: reply, createdAt: new Date().toISOString() };

      saveJarvisState({
        ...state,
        messages: [...nextMessages, assistantMessage].slice(-80),
        memories: updatedMemories,
        nextMove: data.nextMove?.title ? data.nextMove : state.nextMove,
      });

      speak(reply);
    } catch {
      setVoiceState("ERROR");
      setCaption("Voice link failed. Open the dashboard to inspect the core connection.");
      restartRecognitionSoon();
    }
  }

  function speak(text: string) {
    if (!("speechSynthesis" in window)) {
      setVoiceState("LISTENING");
      setCaption(text);
      restartRecognitionSoon();
      return;
    }

    speakingRef.current = true;
    try {
      recognitionRef.current?.stop?.();
    } catch {
      // Ignore stop races.
    }

    const spoken = text
      .replace(/```[\s\S]*?```/g, "")
      .replace(/[*_`#>-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.rate = 1.04;
    utterance.pitch = 0.92;
    utterance.onstart = () => {
      setVoiceState("SPEAKING");
      setCaption("JARVIS RESPONDING");
    };
    utterance.onend = () => {
      speakingRef.current = false;
      setVoiceState("LISTENING");
      setCaption("Say “Jarvis” or “Hey Jarvis”");
      restartRecognitionSoon();
    };
    utterance.onerror = () => {
      speakingRef.current = false;
      setVoiceState("LISTENING");
      restartRecognitionSoon();
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  function handleFinalTranscript(raw: string) {
    const transcript = raw.trim();
    if (!transcript) return;

    const wakeMatch = transcript.match(/(?:^|\b)(?:hey\s+)?jarvis\b[\s,:-]*(.*)$/i);
    if (wakeMatch) {
      const command = wakeMatch[1]?.trim() ?? "";
      if (command) {
        void askJarvis(command);
      } else {
        armedRef.current = true;
        setVoiceState("LISTENING");
        setCaption("Yes, Dwight?");
      }
      return;
    }

    if (armedRef.current) void askJarvis(transcript);
  }

  function enableVoice() {
    if (voiceEnabled) {
      voiceEnabledRef.current = false;
      setVoiceEnabled(false);
      setVoiceState("STANDBY");
      setCaption("VOICE STANDBY");
      armedRef.current = false;
      window.speechSynthesis?.cancel();
      try {
        recognitionRef.current?.stop?.();
      } catch {
        // Ignore stop races.
      }
      return;
    }

    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceState("ERROR");
      setCaption("Wake-word listening needs Chrome or Edge speech recognition support.");
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event: any) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result?.[0]?.transcript ?? "";
        if (result.isFinal) handleFinalTranscript(text);
        else interim += text;
      }
      if (interim.trim() && voiceState !== "THINKING" && voiceState !== "SPEAKING") {
        setVoiceState("LISTENING");
        setCaption(interim.trim());
      }
    };
    recognition.onerror = (event: any) => {
      if (event?.error === "not-allowed" || event?.error === "service-not-allowed") {
        voiceEnabledRef.current = false;
        setVoiceEnabled(false);
        setVoiceState("ERROR");
        setCaption("Microphone permission is required for wake-word mode.");
        return;
      }
      restartRecognitionSoon();
    };
    recognition.onend = () => restartRecognitionSoon();

    recognitionRef.current = recognition;
    voiceEnabledRef.current = true;
    setVoiceEnabled(true);
    setVoiceState("LISTENING");
    setCaption("Say “Jarvis” or “Hey Jarvis”");

    try {
      recognition.start();
    } catch {
      restartRecognitionSoon();
    }
  }

  return (
    <main className={`ambient-shell voice-${voiceState.toLowerCase()}`}>
      <div className="ambient-grid" />
      <a className="ambient-dashboard" href="/">COMMAND CORE</a>

      <div className="ambient-identity">
        <strong>HIMIE JOHNSON VENTURES</strong>
        <span>DWIGHT // FOUNDER & OPERATOR</span>
      </div>

      <section className="ambient-center" aria-live="polite">
        <div className="jarvis-orbit" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit orbit-three" />
          <div className="jarvis-core"><span>JARVIS</span></div>
        </div>

        <div className="ambient-time">{time}</div>
        <div className="ambient-date">{date}</div>
        <div className="ambient-caption">{caption}</div>
      </section>

      <button className={`voice-toggle ${voiceEnabled ? "enabled" : ""}`} type="button" onClick={enableVoice}>
        <span className="voice-dot" /> {voiceEnabled ? "VOICE ACTIVE" : "ENABLE VOICE"}
      </button>
    </main>
  );
}
