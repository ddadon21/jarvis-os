"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { loadJarvisState, saveJarvisState } from "../lib/jarvis-state";

export type JarvisVoiceState = "STANDBY" | "LISTENING" | "THINKING" | "SPEAKING" | "ERROR";

type JarvisVoiceContextValue = {
  voiceEnabled: boolean;
  voiceState: JarvisVoiceState;
  caption: string;
  fullscreen: boolean;
  toggleVoice: () => void;
  toggleFullscreen: () => Promise<void>;
  goHome: () => void;
  goWork: () => void;
};

const JarvisVoiceContext = createContext<JarvisVoiceContextValue | null>(null);
const VOICE_STORAGE_KEY = "jarvis-voice-enabled-v1";

export function useJarvisVoice() {
  const value = useContext(JarvisVoiceContext);
  if (!value) throw new Error("useJarvisVoice must be used inside JarvisVoiceProvider");
  return value;
}

function cleanForSpeech(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[*_`#>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreVoice(voice: SpeechSynthesisVoice) {
  const name = voice.name.toLowerCase();
  const lang = voice.lang.toLowerCase();
  let score = 0;

  if (lang.startsWith("en-us")) score += 80;
  else if (lang.startsWith("en-gb")) score += 65;
  else if (lang.startsWith("en")) score += 45;

  if (/natural|premium|enhanced|online/.test(name)) score += 70;
  if (/guy|davis|andrew|christopher|mark|david|male/.test(name)) score += 45;
  if (/microsoft|google/.test(name)) score += 20;
  if (/zira|samantha|victoria|female/.test(name)) score -= 20;

  return score;
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
  const preferredVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const pendingSpeechRef = useRef(0);
  const streamDoneRef = useRef(true);
  const speechBufferRef = useRef("");

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
    if (!("speechSynthesis" in window)) return;

    const chooseVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      if (!voices.length) return;
      preferredVoiceRef.current = [...voices].sort((a, b) => scoreVoice(b) - scoreVoice(a))[0] ?? null;
    };

    chooseVoice();
    window.speechSynthesis.addEventListener("voiceschanged", chooseVoice);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", chooseVoice);
  }, []);

  useEffect(() => {
    const remembered = window.localStorage.getItem(VOICE_STORAGE_KEY) === "true";
    if (remembered) window.setTimeout(() => startVoice(true), 450);

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

  function restartRecognitionSoon(delay = 180) {
    if (!voiceEnabledRef.current || speakingRef.current) return;
    if (voiceStateRef.current === "THINKING" || voiceStateRef.current === "SPEAKING") return;

    window.setTimeout(() => {
      if (!voiceEnabledRef.current || speakingRef.current) return;
      if (voiceStateRef.current === "THINKING" || voiceStateRef.current === "SPEAKING") return;
      try {
        recognitionRef.current?.start?.();
      } catch {
        // Browser may already be listening.
      }
    }, delay);
  }

  function finishSpeakingIfReady() {
    if (!streamDoneRef.current || pendingSpeechRef.current > 0) return;
    speakingRef.current = false;
    setVoice("LISTENING");
    setCaption("Say “Jarvis” or “Hey Jarvis”");
    restartRecognitionSoon(120);
  }

  function queueSpeech(text: string) {
    const spoken = cleanForSpeech(text);
    if (!spoken || !("speechSynthesis" in window)) return;

    if (!speakingRef.current) {
      speakingRef.current = true;
      setVoice("SPEAKING");
      setCaption("JARVIS RESPONDING");
      try {
        recognitionRef.current?.stop?.();
      } catch {
        // Ignore stop races.
      }
    }

    const utterance = new SpeechSynthesisUtterance(spoken);
    const preferred = preferredVoiceRef.current;
    if (preferred) utterance.voice = preferred;
    utterance.lang = preferred?.lang || "en-US";
    utterance.rate = 1.0;
    utterance.pitch = 0.86;
    utterance.volume = 1;

    pendingSpeechRef.current += 1;
    const done = () => {
      pendingSpeechRef.current = Math.max(0, pendingSpeechRef.current - 1);
      finishSpeakingIfReady();
    };
    utterance.onend = done;
    utterance.onerror = done;
    window.speechSynthesis.speak(utterance);
  }

  function flushSpeechBuffer(force = false) {
    let buffer = speechBufferRef.current;

    while (buffer.trim()) {
      const sentenceMatch = buffer.match(/^([\s\S]*?[.!?])(?=\s|$)/);
      if (sentenceMatch) {
        queueSpeech(sentenceMatch[1]);
        buffer = buffer.slice(sentenceMatch[0].length).trimStart();
        continue;
      }

      if (!force && buffer.length >= 125) {
        const searchArea = buffer.slice(0, 145);
        const punctuationCut = Math.max(searchArea.lastIndexOf(", "), searchArea.lastIndexOf("; "), searchArea.lastIndexOf(": "));
        const spaceCut = searchArea.lastIndexOf(" ");
        const cut = punctuationCut >= 70 ? punctuationCut + 1 : spaceCut >= 90 ? spaceCut : -1;
        if (cut > 0) {
          queueSpeech(buffer.slice(0, cut));
          buffer = buffer.slice(cut).trimStart();
          continue;
        }
      }

      if (force) {
        queueSpeech(buffer);
        buffer = "";
      }
      break;
    }

    speechBufferRef.current = buffer;
  }

  async function askJarvis(command: string) {
    const clean = command.trim();
    if (!clean) return;

    armedRef.current = false;
    speakingRef.current = false;
    pendingSpeechRef.current = 0;
    streamDoneRef.current = false;
    speechBufferRef.current = "";
    window.speechSynthesis?.cancel();

    try {
      recognitionRef.current?.stop?.();
    } catch {
      // Ignore recognition stop races.
    }

    setVoice("THINKING");
    setCaption("JARVIS THINKING");

    const state = loadJarvisState();
    const userMessage = { role: "user" as const, content: clean, createdAt: new Date().toISOString() };
    const nextMessages = [...state.messages, userMessage].slice(-80);
    saveJarvisState({ ...state, messages: nextMessages });
    window.dispatchEvent(new CustomEvent("jarvis-state-updated"));

    try {
      const response = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
          activeDomain: state.activeDomain,
          goals: state.goals,
          memories: state.memories.map(({ domain, fact }) => ({ domain, fact })),
        }),
      });

      if (!response.ok || !response.body) {
        const message = await response.text().catch(() => "Voice fast lane unavailable.");
        throw new Error(message || "Voice fast lane unavailable.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullReply = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) continue;
        fullReply += chunk;
        speechBufferRef.current += chunk;
        flushSpeechBuffer(false);
      }

      fullReply += decoder.decode();
      flushSpeechBuffer(true);
      streamDoneRef.current = true;

      const reply = fullReply.trim() || "I did not receive a usable response.";
      const assistantMessage = { role: "assistant" as const, content: reply, createdAt: new Date().toISOString() };

      saveJarvisState({
        ...state,
        messages: [...nextMessages, assistantMessage].slice(-80),
      });
      window.dispatchEvent(new CustomEvent("jarvis-state-updated"));

      if (pendingSpeechRef.current === 0) {
        if ("speechSynthesis" in window && reply) queueSpeech(reply);
        streamDoneRef.current = true;
        finishSpeakingIfReady();
      }
    } catch (error) {
      streamDoneRef.current = true;
      speakingRef.current = false;
      pendingSpeechRef.current = 0;
      setVoice("ERROR");
      setCaption(error instanceof Error ? error.message.slice(0, 110).toUpperCase() : "VOICE LINK FAILED");
      window.setTimeout(() => {
        if (!voiceEnabledRef.current) return;
        setVoice("LISTENING");
        setCaption("Say “Jarvis” or “Hey Jarvis”");
        restartRecognitionSoon(200);
      }, 1400);
    }
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
      restartRecognitionSoon(350);
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
      restartRecognitionSoon(isRestore ? 500 : 160);
    }
  }

  function stopVoice() {
    voiceEnabledRef.current = false;
    setVoiceEnabled(false);
    armedRef.current = false;
    speakingRef.current = false;
    pendingSpeechRef.current = 0;
    streamDoneRef.current = true;
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

  function goHome() {
    router.push("/home");
  }

  function goWork() {
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
      goHome,
      goWork,
    }),
    [caption, fullscreen, voiceEnabled, voiceState],
  );

  const home = pathname === "/home" || pathname === "/ambient";

  return (
    <JarvisVoiceContext.Provider value={value}>
      {children}
      <div className={`jarvis-global-controls ${home ? "ambient-controls" : ""}`}>
        <button type="button" className={voiceEnabled ? "active" : ""} onClick={toggleVoice}>
          <span className="global-dot" /> {voiceEnabled ? "VOICE ON" : "VOICE OFF"}
        </button>
        <button type="button" onClick={home ? goWork : goHome}>
          {home ? "WORK" : "HOME"}
        </button>
        <button type="button" className={fullscreen ? "active" : ""} onClick={() => void toggleFullscreen()}>
          {fullscreen ? "EXIT FULLSCREEN" : "FULLSCREEN"}
        </button>
      </div>
      {!home && voiceEnabled && (
        <div className={`jarvis-voice-status state-${voiceState.toLowerCase()}`}>
          <span>{voiceState}</span>
          <strong>{caption}</strong>
        </div>
      )}
    </JarvisVoiceContext.Provider>
  );
}
