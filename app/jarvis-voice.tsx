"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { loadJarvisState, mergeMemories, saveJarvisState } from "../lib/jarvis-state";

export type JarvisVoiceState = "STANDBY" | "LISTENING" | "THINKING" | "SPEAKING" | "ERROR";

type ApiResponse = {
  reply?: string;
  memoryUpdates?: Array<{ domain?: string; fact?: string }>;
  nextMove?: { title: string; reason: string; domain: "TRADING" | "FINANCE" | "SENTRYOPS" | "LIFE" | "CORE" };
};

type JarvisVoiceContextValue = {
  voiceEnabled: boolean;
  voiceState: JarvisVoiceState;
  caption: string;
  fullscreen: boolean;
  toggleVoice: () => void;
  toggleFullscreen: () => Promise<void>;
  goAmbient: () => void;
  goDashboard: () => void;
};

const JarvisVoiceContext = createContext<JarvisVoiceContextValue | null>(null);
const VOICE_STORAGE_KEY = "jarvis-voice-enabled-v1";

export function useJarvisVoice() {
  const value = useContext(JarvisVoiceContext);
  if (!value) throw new Error("useJarvisVoice must be used inside JarvisVoiceProvider");
  return value;
}

export default function JarvisVoiceProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceState, setVoiceState] = useState<JarvisVoiceState>("STANDBY");
  const [caption, setCaption] = useState("Say “Jarvis” or “Hey Jarvis”");
  const [fullscreen, setFullscreen] = useState(false);

  const recognitionRef = useRef<any>(null);
  const voiceEnabledRef = useRef(false);
  const speakingRef = useRef(false);
  const armedRef = useRef(false);
  const voiceStateRef = useRef<JarvisVoiceState>("STANDBY");

  function setVoice(next: JarvisVoiceState) {
    voiceStateRef.current = next;
    setVoiceState(next);
  }

  useEffect(() => {
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreen);
    onFullscreen();
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  useEffect(() => {
    const remembered = window.localStorage.getItem(VOICE_STORAGE_KEY) === "true";
    if (remembered) {
      window.setTimeout(() => startVoice(true), 450);
    }

    return () => {
      voiceEnabledRef.current = false;
      try {
        recognitionRef.current?.stop?.();
      } catch {
        // Ignore browser speech-recognition teardown races.
      }
      window.speechSynthesis?.cancel();
    };
    // Mount once so the listener survives route changes under the root layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function restartRecognitionSoon(delay = 220) {
    if (!voiceEnabledRef.current || speakingRef.current) return;
    window.setTimeout(() => {
      if (!voiceEnabledRef.current || speakingRef.current) return;
      try {
        recognitionRef.current?.start?.();
      } catch {
        // Browser may already be listening.
      }
    }, delay);
  }

  async function askJarvis(command: string) {
    const clean = command.trim();
    if (!clean) return;

    armedRef.current = false;
    setVoice("THINKING");
    setCaption(clean);

    const state = loadJarvisState();
    const userMessage = { role: "user" as const, content: clean, createdAt: new Date().toISOString() };
    const nextMessages = [...state.messages, userMessage].slice(-80);
    saveJarvisState({ ...state, messages: nextMessages });
    window.dispatchEvent(new CustomEvent("jarvis-state-updated"));

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
      const updatedMemories = Array.isArray(data.memoryUpdates)
        ? mergeMemories(state.memories, data.memoryUpdates)
        : state.memories;
      const assistantMessage = { role: "assistant" as const, content: reply, createdAt: new Date().toISOString() };

      saveJarvisState({
        ...state,
        messages: [...nextMessages, assistantMessage].slice(-80),
        memories: updatedMemories,
        nextMove: data.nextMove?.title ? data.nextMove : state.nextMove,
      });
      window.dispatchEvent(new CustomEvent("jarvis-state-updated"));

      speak(reply);
    } catch {
      setVoice("ERROR");
      setCaption("VOICE LINK FAILED · CORE REMAINS ONLINE");
      restartRecognitionSoon(600);
    }
  }

  function speak(text: string) {
    if (!("speechSynthesis" in window)) {
      setVoice("LISTENING");
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
    utterance.rate = 1.06;
    utterance.pitch = 0.92;
    utterance.onstart = () => {
      setVoice("SPEAKING");
      setCaption("JARVIS RESPONDING");
    };
    utterance.onend = () => {
      speakingRef.current = false;
      setVoice("LISTENING");
      setCaption("Say “Jarvis” or “Hey Jarvis”");
      restartRecognitionSoon();
    };
    utterance.onerror = () => {
      speakingRef.current = false;
      setVoice("LISTENING");
      setCaption("Say “Jarvis” or “Hey Jarvis”");
      restartRecognitionSoon();
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  function handleFinalTranscript(raw: string) {
    const transcript = raw.trim();
    if (!transcript) return;

    const wakeMatch = transcript.match(/(?:^|\b)(?:(?:hey|okay|ok|yo)\s+)?jarvis\b[\s,:-]*(.*)$/i);
    if (wakeMatch) {
      const command = wakeMatch[1]?.trim() ?? "";
      if (command) {
        void askJarvis(command);
      } else {
        armedRef.current = true;
        setVoice("LISTENING");
        setCaption("Yes, Dwight?");
      }
      return;
    }

    if (armedRef.current) void askJarvis(transcript);
  }

  function buildRecognition() {
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Recognition) return null;

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

      if (interim.trim() && voiceStateRef.current !== "THINKING" && voiceStateRef.current !== "SPEAKING") {
        setVoice("LISTENING");
        setCaption(interim.trim());
      }
    };
    recognition.onerror = (event: any) => {
      if (event?.error === "not-allowed" || event?.error === "service-not-allowed") {
        voiceEnabledRef.current = false;
        setVoiceEnabled(false);
        window.localStorage.setItem(VOICE_STORAGE_KEY, "false");
        setVoice("ERROR");
        setCaption("MICROPHONE PERMISSION REQUIRED");
        return;
      }
      restartRecognitionSoon(500);
    };
    recognition.onend = () => restartRecognitionSoon();
    return recognition;
  }

  function startVoice(isRestore = false) {
    if (voiceEnabledRef.current) return;

    const recognition = recognitionRef.current ?? buildRecognition();
    if (!recognition) {
      setVoice("ERROR");
      setCaption("VOICE REQUIRES CHROME OR EDGE SPEECH SUPPORT");
      return;
    }

    recognitionRef.current = recognition;
    voiceEnabledRef.current = true;
    setVoiceEnabled(true);
    window.localStorage.setItem(VOICE_STORAGE_KEY, "true");
    setVoice("LISTENING");
    setCaption("Say “Jarvis” or “Hey Jarvis”");

    try {
      recognition.start();
    } catch {
      if (isRestore) {
        restartRecognitionSoon(700);
      } else {
        restartRecognitionSoon();
      }
    }
  }

  function stopVoice() {
    voiceEnabledRef.current = false;
    setVoiceEnabled(false);
    armedRef.current = false;
    speakingRef.current = false;
    window.localStorage.setItem(VOICE_STORAGE_KEY, "false");
    window.speechSynthesis?.cancel();
    try {
      recognitionRef.current?.stop?.();
    } catch {
      // Ignore stop races.
    }
    setVoice("STANDBY");
    setCaption("VOICE STANDBY");
  }

  function toggleVoice() {
    if (voiceEnabledRef.current) stopVoice();
    else startVoice();
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      const request = document.documentElement.requestFullscreen.bind(document.documentElement) as any;
      try {
        await request({ navigationUI: "hide" });
      } catch {
        await request();
      }
    } catch {
      setCaption("FULLSCREEN WAS BLOCKED BY THE BROWSER");
    }
  }

  function goAmbient() {
    router.push("/ambient");
  }

  function goDashboard() {
    router.push("/");
  }

  const value = useMemo<JarvisVoiceContextValue>(
    () => ({
      voiceEnabled,
      voiceState,
      caption,
      fullscreen,
      toggleVoice,
      toggleFullscreen,
      goAmbient,
      goDashboard,
    }),
    [caption, fullscreen, voiceEnabled, voiceState],
  );

  const ambient = pathname === "/ambient";

  return (
    <JarvisVoiceContext.Provider value={value}>
      {children}
      <div className={`jarvis-global-controls ${ambient ? "ambient-controls" : ""}`}>
        <button type="button" className={voiceEnabled ? "active" : ""} onClick={toggleVoice}>
          <span className="global-dot" /> {voiceEnabled ? "VOICE ON" : "VOICE OFF"}
        </button>
        <button type="button" onClick={ambient ? goDashboard : goAmbient}>
          {ambient ? "COMMAND CORE" : "AMBIENT"}
        </button>
        <button type="button" className={fullscreen ? "active" : ""} onClick={() => void toggleFullscreen()}>
          {fullscreen ? "EXIT FULLSCREEN" : "FULLSCREEN"}
        </button>
      </div>
      {!ambient && voiceEnabled && (
        <div className={`jarvis-voice-status state-${voiceState.toLowerCase()}`}>
          <span>{voiceState}</span>
          <strong>{caption}</strong>
        </div>
      )}
    </JarvisVoiceContext.Provider>
  );
}
