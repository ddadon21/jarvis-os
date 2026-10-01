"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { loadJarvisState, saveJarvisState } from "../lib/jarvis-state";
import { tryExecuteDesktopText } from "../lib/jarvis-desktop-client";
import JarvisPresence from "./jarvis-presence";

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

type RealtimeEvent = {
  type?: string;
  transcript?: string;
  delta?: string;
  error?: { message?: string };
};

const JarvisVoiceContext = createContext<JarvisVoiceContextValue | null>(null);
const VOICE_STORAGE_KEY = "jarvis-voice-enabled-v1";
const REALTIME_IDLE_MS = 10 * 60_000;

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

function scoreFallbackVoice(voice: SpeechSynthesisVoice) {
  const name = voice.name.toLowerCase();
  const lang = voice.lang.toLowerCase();
  let score = 0;

  if (lang.startsWith("en-gb")) score += 110;
  else if (lang.startsWith("en-us")) score += 60;
  else if (lang.startsWith("en")) score += 40;
  if (/natural|premium|enhanced|online/.test(name)) score += 80;
  if (/ryan|george|guy|david|male|microsoft/.test(name)) score += 40;
  if (/zira|samantha|victoria|female/.test(name)) score -= 30;
  return score;
}

export default function JarvisVoiceProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceState, setVoiceState] = useState<JarvisVoiceState>("STANDBY");
  const [caption, setCaption] = useState("VOICE STANDBY");
  const [fullscreen, setFullscreen] = useState(false);

  const recognitionRef = useRef<any>(null);
  const voiceEnabledRef = useRef(false);
  const voiceStateRef = useRef<JarvisVoiceState>("STANDBY");
  const fallbackArmedRef = useRef(false);
  const preferredVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const elevenAudioRef = useRef<HTMLAudioElement | null>(null);
  const premiumSpeechChainRef = useRef<Promise<void>>(Promise.resolve());
  const elevenUnavailableRef = useRef(false);
  const elevenVerifiedRef = useRef(false);
  const fallbackPendingSpeechRef = useRef(0);
  const fallbackStreamDoneRef = useRef(true);
  const fallbackSpeechBufferRef = useRef("");
  const fallbackSpeakingRef = useRef(false);
  const speechGenerationRef = useRef(0);
  const pendingTranscriptRef = useRef("");
  const pendingTranscriptTimerRef = useRef<number | null>(null);

  const realtimePeerRef = useRef<RTCPeerConnection | null>(null);
  const realtimeChannelRef = useRef<RTCDataChannel | null>(null);
  const realtimeStreamRef = useRef<MediaStream | null>(null);
  const realtimeAudioRef = useRef<HTMLAudioElement | null>(null);
  const realtimeActiveRef = useRef(false);
  const realtimeIdleRef = useRef<number | null>(null);
  const skipNextAssistantTranscriptRef = useRef(false);

  function setVoice(next: JarvisVoiceState) {
    voiceStateRef.current = next;
    setVoiceState(next);
  }

  function appendMessage(role: "user" | "assistant", content: string) {
    const clean = content.trim();
    if (!clean) return;
    const state = loadJarvisState();
    const last = state.messages[state.messages.length - 1];
    if (last?.role === role && last.content.trim() === clean) return;
    saveJarvisState({
      ...state,
      messages: [...state.messages, { role, content: clean, createdAt: new Date().toISOString() }].slice(-80),
    });
    window.dispatchEvent(new CustomEvent("jarvis-state-updated"));
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
      preferredVoiceRef.current = [...voices].sort((a, b) => scoreFallbackVoice(b) - scoreFallbackVoice(a))[0] ?? null;
    };
    chooseVoice();
    window.speechSynthesis.addEventListener("voiceschanged", chooseVoice);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", chooseVoice);
  }, []);

  useEffect(() => {
    const onProactiveSpeak = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string; priority?: string }>).detail;
      const text = detail?.text?.trim();
      if (!text || !voiceEnabledRef.current) return;

      stopWakeRecognition();
      appendMessage("assistant", text);
      fallbackStreamDoneRef.current = true;
      fallbackPendingSpeechRef.current = 0;
      fallbackSpeechBufferRef.current = "";
      window.speechSynthesis?.cancel();
      queueFallbackSpeech(text);
    };

    window.addEventListener("jarvis-proactive-speak", onProactiveSpeak);
    return () => window.removeEventListener("jarvis-proactive-speak", onProactiveSpeak);
  }, []);

  useEffect(() => {
    const remembered = window.localStorage.getItem(VOICE_STORAGE_KEY) === "true";
    if (remembered) window.setTimeout(() => startVoice(true), 100);

    return () => {
      voiceEnabledRef.current = false;
      stopWakeRecognition();
      closeRealtime(false);
      window.speechSynthesis?.cancel();
      elevenAudioRef.current?.pause();
      elevenAudioRef.current = null;
    };
    // Root provider intentionally mounts once so voice survives HOME/WORK route changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verifyPremiumVoice() {
    try {
      const response = await fetch("/api/voice/elevenlabs", { cache: "no-store" });
      if (!response.ok) {
        elevenVerifiedRef.current = false;
        elevenUnavailableRef.current = true;
        return false;
      }
      const body = await response.json() as {
        configured?: boolean;
        voiceVerified?: boolean;
        runtimeState?: {
          status?: "UNKNOWN" | "CONNECTED" | "PLAN_REQUIRED" | "AUTH_ERROR" | "DEGRADED";
        };
      };
      const configured = body.configured === true;
      const runtimeStatus = body.runtimeState?.status ?? "UNKNOWN";
      elevenVerifiedRef.current = runtimeStatus === "CONNECTED";
      elevenUnavailableRef.current = !configured;

      if (!configured) {
        setCaption("ELEVENLABS NOT CONFIGURED");
        return false;
      }

      if (runtimeStatus === "CONNECTED") setCaption("ELEVENLABS ONLINE");
      else if (runtimeStatus === "PLAN_REQUIRED") setCaption("ELEVENLABS PLAN REQUIRED");
      else if (runtimeStatus === "AUTH_ERROR") setCaption("ELEVENLABS AUTH ERROR");
      else if (runtimeStatus === "DEGRADED") setCaption("ELEVENLABS DEGRADED");
      else setCaption("ELEVENLABS READY");

      // Configuration is enough to keep the TTS path eligible for a fresh retry.
      // The actual POST / TTS result decides whether speech succeeds.
      return true;
    } catch {
      elevenVerifiedRef.current = false;
      elevenUnavailableRef.current = true;
      return false;
    }
  }

  function stopWakeRecognition() {
    try {
      recognitionRef.current?.stop?.();
    } catch {
      // Ignore browser speech recognition stop races.
    }
  }

  function restartWakeSoon(delay = 75, allowDuringSpeech = false) {
    if (!voiceEnabledRef.current || realtimeActiveRef.current || (!allowDuringSpeech && fallbackSpeakingRef.current)) return;
    window.setTimeout(() => {
      if (!voiceEnabledRef.current || realtimeActiveRef.current || (!allowDuringSpeech && fallbackSpeakingRef.current)) return;
      try {
        recognitionRef.current?.start?.();
      } catch {
        // Browser may already be listening.
      }
    }, delay);
  }

  function clearRealtimeIdle() {
    if (realtimeIdleRef.current !== null) {
      window.clearTimeout(realtimeIdleRef.current);
      realtimeIdleRef.current = null;
    }
  }

  function touchRealtime() {
    clearRealtimeIdle();
    realtimeIdleRef.current = window.setTimeout(() => closeRealtime(true), REALTIME_IDLE_MS);
  }

  function closeRealtime(resumeWake = true) {
    clearRealtimeIdle();
    realtimeActiveRef.current = false;

    try {
      realtimeChannelRef.current?.close();
    } catch {
      // Ignore WebRTC teardown races.
    }
    realtimeChannelRef.current = null;

    try {
      realtimePeerRef.current?.close();
    } catch {
      // Ignore WebRTC teardown races.
    }
    realtimePeerRef.current = null;

    realtimeStreamRef.current?.getTracks().forEach((track) => track.stop());
    realtimeStreamRef.current = null;

    const audio = realtimeAudioRef.current;
    if (audio) {
      try {
        audio.pause();
        audio.srcObject = null;
        audio.remove();
      } catch {
        // Ignore audio element teardown races.
      }
    }
    realtimeAudioRef.current = null;

    if (resumeWake && voiceEnabledRef.current) {
      setVoice("LISTENING");
      setCaption("VOICE ONLINE · TALK NORMALLY");
      restartWakeSoon(90);
    }
  }

  function sendRealtimeText(command: string) {
    const channel = realtimeChannelRef.current;
    if (!channel || channel.readyState !== "open") return;
    appendMessage("user", command);
    channel.send(JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: command }],
      },
    }));
    channel.send(JSON.stringify({ type: "response.create" }));
    setVoice("THINKING");
    setCaption("JARVIS THINKING");
    touchRealtime();
  }

  function sendRealtimeAcknowledgement() {
    const channel = realtimeChannelRef.current;
    if (!channel || channel.readyState !== "open") return;
    skipNextAssistantTranscriptRef.current = true;
    channel.send(JSON.stringify({
      type: "response.create",
      response: {
        instructions: "Acknowledge the wake word naturally in no more than four words. Say: Yes, Dwight?",
      },
    }));
    touchRealtime();
  }

  function handleRealtimeEvent(raw: string) {
    let event: RealtimeEvent;
    try {
      event = JSON.parse(raw) as RealtimeEvent;
    } catch {
      return;
    }

    switch (event.type) {
      case "session.created":
      case "session.updated":
        setVoice("LISTENING");
        setCaption("REALTIME VOICE ONLINE · TALK NORMALLY");
        touchRealtime();
        break;
      case "input_audio_buffer.speech_started":
        setVoice("LISTENING");
        setCaption("LISTENING");
        touchRealtime();
        break;
      case "input_audio_buffer.speech_stopped":
        setVoice("THINKING");
        setCaption("JARVIS THINKING");
        touchRealtime();
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (event.transcript?.trim()) appendMessage("user", event.transcript);
        break;
      case "response.created":
        setVoice("THINKING");
        setCaption("JARVIS THINKING");
        break;
      case "response.output_audio.delta":
        setVoice("SPEAKING");
        setCaption("JARVIS RESPONDING");
        touchRealtime();
        break;
      case "response.output_audio_transcript.done":
        if (skipNextAssistantTranscriptRef.current) {
          skipNextAssistantTranscriptRef.current = false;
        } else if (event.transcript?.trim()) {
          appendMessage("assistant", event.transcript);
        }
        break;
      case "response.done":
        setVoice("LISTENING");
        setCaption("REALTIME VOICE ONLINE · CONTINUE SPEAKING");
        touchRealtime();
        break;
      case "error":
        setVoice("ERROR");
        setCaption((event.error?.message || "REALTIME VOICE ERROR").slice(0, 110).toUpperCase());
        break;
      default:
        break;
    }
  }

  async function startRealtime(initialCommand = "") {
    if (realtimeActiveRef.current && realtimeChannelRef.current?.readyState === "open") {
      if (initialCommand.trim()) sendRealtimeText(initialCommand.trim());
      return;
    }

    if (!("RTCPeerConnection" in window) || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("Realtime WebRTC voice is not supported in this browser.");
    }

    stopWakeRecognition();
    window.speechSynthesis?.cancel();
    fallbackSpeakingRef.current = false;
    setVoice("THINKING");
    setCaption("OPENING NEURAL VOICE LINK");

    const peer = new RTCPeerConnection();
    realtimePeerRef.current = peer;

    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.setAttribute("playsinline", "true");
    audio.style.display = "none";
    document.body.appendChild(audio);
    realtimeAudioRef.current = audio;

    peer.ontrack = (event) => {
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void audio.play().catch(() => {
        setCaption("CLICK VOICE ONCE TO ALLOW AUDIO PLAYBACK");
      });
    };

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "connected") {
        realtimeActiveRef.current = true;
        setVoice("LISTENING");
        setCaption("REALTIME VOICE ONLINE · TALK NORMALLY");
        touchRealtime();
      }
      if (peer.connectionState === "failed" || peer.connectionState === "closed") {
        closeRealtime(true);
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    realtimeStreamRef.current = stream;
    stream.getAudioTracks().forEach((track) => peer.addTrack(track, stream));

    const channel = peer.createDataChannel("oai-events");
    realtimeChannelRef.current = channel;
    channel.onmessage = (event) => handleRealtimeEvent(String(event.data));
    channel.onerror = () => {
      setVoice("ERROR");
      setCaption("NEURAL VOICE DATA LINK ERROR");
    };
    channel.onopen = () => {
      realtimeActiveRef.current = true;
      setVoice("LISTENING");
      setCaption("NEURAL VOICE ONLINE");
      if (initialCommand.trim()) sendRealtimeText(initialCommand.trim());
      else sendRealtimeAcknowledgement();
      touchRealtime();
    };

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    const state = loadJarvisState();
    const response = await fetch("/api/realtime/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sdp: offer.sdp,
        activeDomain: state.activeDomain,
        goals: state.goals,
        memories: state.memories.map(({ domain, fact }) => ({ domain, fact })),
        recentMessages: state.messages.slice(-8).map(({ role, content }) => ({ role, content })),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "Realtime voice unavailable.");
      closeRealtime(false);
      throw new Error(detail || "Realtime voice unavailable.");
    }

    const answerSdp = await response.text();
    await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });
  }

  function finishFallbackIfReady() {
    if (!fallbackStreamDoneRef.current || fallbackPendingSpeechRef.current > 0) return;
    fallbackSpeakingRef.current = false;
    if (!voiceEnabledRef.current) return;
    fallbackArmedRef.current = true;
    setVoice("LISTENING");
    setCaption("VOICE ONLINE · TALK NORMALLY");
    restartWakeSoon(70);
  }

  function playBrowserSpeech(spoken: string) {
    return new Promise<void>((resolve) => {
      if (!("speechSynthesis" in window)) {
        resolve();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(spoken);
      const preferred = preferredVoiceRef.current;
      if (preferred) utterance.voice = preferred;
      utterance.lang = preferred?.lang || "en-GB";
      utterance.rate = 0.96;
      utterance.pitch = 0.8;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
    });
  }

  async function prepareElevenLabsSpeech(spoken: string): Promise<
    | { state: "READY"; blob: Blob }
    | { state: "FALLBACK" }
    | { state: "BLOCKED" }
  > {
    if (elevenUnavailableRef.current) return { state: "FALLBACK" };
    try {
      const response = await fetch("/api/voice/elevenlabs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: spoken }),
      });
      if (!response.ok) {
        if (response.status === 402) {
          setCaption("ELEVENLABS PLAN REQUIRED");
          return { state: "BLOCKED" };
        }
        if (response.status === 401 || response.status === 403) {
          setCaption("ELEVENLABS AUTH ERROR");
          return { state: "BLOCKED" };
        }
        if (response.status === 503) elevenUnavailableRef.current = true;
        return { state: "FALLBACK" };
      }

      const blob = await response.blob();
      if (!blob.size) return { state: "FALLBACK" };
      return { state: "READY", blob };
    } catch {
      return { state: "FALLBACK" };
    }
  }

  async function playPreparedElevenLabs(blob: Blob, generation: number) {
    if (generation !== speechGenerationRef.current) return;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    elevenAudioRef.current = audio;
    audio.preload = "auto";
    setCaption("JARVIS RESPONDING · ELEVENLABS");

    await new Promise<void>((resolve) => {
      const done = () => {
        audio.onended = null;
        audio.onerror = null;
        if (elevenAudioRef.current === audio) elevenAudioRef.current = null;
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      void audio.play().catch(done);
    });
  }

  function queueFallbackSpeech(text: string) {
    const spoken = cleanForSpeech(text);
    if (!spoken) return;

    const generation = speechGenerationRef.current;
    // Start synthesis immediately. Playback remains ordered, so later clauses can
    // generate while the current clause is already being spoken.
    const prepared = prepareElevenLabsSpeech(spoken);

    fallbackSpeakingRef.current = true;
    setVoice("SPEAKING");
    setCaption("JARVIS RESPONDING");
    fallbackPendingSpeechRef.current += 1;
    // Keep recognition alive for explicit "Jarvis ..." barge-in commands.
    restartWakeSoon(120, true);

    premiumSpeechChainRef.current = premiumSpeechChainRef.current
      .catch(() => undefined)
      .then(async () => {
        if (generation !== speechGenerationRef.current) return;
        const elevenState = await prepared;
        if (generation !== speechGenerationRef.current) return;
        if (elevenState.state === "READY") {
          await playPreparedElevenLabs(elevenState.blob, generation);
        } else if (elevenState.state === "FALLBACK") {
          setCaption("JARVIS RESPONDING · FALLBACK VOICE");
          await playBrowserSpeech(spoken);
        }
      })
      .finally(() => {
        fallbackPendingSpeechRef.current = Math.max(0, fallbackPendingSpeechRef.current - 1);
        finishFallbackIfReady();
      });
  }

  function flushFallbackBuffer(force = false) {
    let buffer = fallbackSpeechBufferRef.current;
    while (buffer.trim()) {
      const sentence = buffer.match(/^([\s\S]*?[.!?])(?=\s|$)/);
      if (sentence) {
        queueFallbackSpeech(sentence[1]);
        buffer = buffer.slice(sentence[0].length).trimStart();
        continue;
      }

      // Start the first useful clause early instead of waiting for an entire sentence.
      const clause = buffer.match(/^([\s\S]{38,}?[;:])(?=\s|$)/);
      if (clause) {
        queueFallbackSpeech(clause[1]);
        buffer = buffer.slice(clause[0].length).trimStart();
        continue;
      }

      if (!force && buffer.length > 72) {
        const cut = buffer.slice(0, 96).lastIndexOf(" ");
        if (cut > 48) {
          queueFallbackSpeech(buffer.slice(0, cut));
          buffer = buffer.slice(cut).trimStart();
          continue;
        }
      }
      if (force) {
        queueFallbackSpeech(buffer);
        buffer = "";
      }
      break;
    }
    fallbackSpeechBufferRef.current = buffer;
  }

  async function answerLocalVoiceCommand(command: string) {
    const lower = command.toLowerCase();
    if (!/payout|pay out/.test(lower)) return null;

    try {
      const response = await fetch("/api/trading/payouts?range=ALL", { cache: "no-store" });
      if (!response.ok) return null;
      const body = await response.json() as {
        summary?: {
          lifetimeCount?: number;
          totalAmount?: number;
          averageAmount?: number | null;
          nextPayoutNumber?: number;
          latest?: { payoutAmount?: number; firm?: string } | null;
        };
      };
      const summary = body.summary;
      if (!summary || typeof summary.totalAmount !== "number") return null;

      const count = summary.lifetimeCount ?? 0;
      const average = summary.averageAmount ?? (count > 0 ? summary.totalAmount / count : null);
      const latest = summary.latest;
      const parts = [
        `You have ${count} all-time payout${count === 1 ? "" : "s"} totaling ${summary.totalAmount.toLocaleString("en-US", { style: "currency", currency: "USD" })}.`,
        average == null ? "" : `Your average payout is ${average.toLocaleString("en-US", { style: "currency", currency: "USD" })}.`,
        latest?.payoutAmount == null ? "" : `Your latest recorded payout is ${latest.payoutAmount.toLocaleString("en-US", { style: "currency", currency: "USD" })}${latest.firm ? ` from ${latest.firm}` : ""}.`,
        summary.nextPayoutNumber ? `Your next one is payout number ${summary.nextPayoutNumber}.` : "",
      ].filter(Boolean);
      return parts.join(" ");
    } catch {
      return null;
    }
  }

  async function askFallback(command: string) {
    const clean = command.trim();
    if (!clean) return;
    appendMessage("user", clean);

    const localAnswer = await answerLocalVoiceCommand(clean);
    if (localAnswer) {
      stopWakeRecognition();
      fallbackPendingSpeechRef.current = 0;
      fallbackStreamDoneRef.current = true;
      fallbackSpeechBufferRef.current = "";
      window.speechSynthesis?.cancel();
      appendMessage("assistant", localAnswer);
      queueFallbackSpeech(localAnswer);
      return;
    }

    stopWakeRecognition();
    fallbackPendingSpeechRef.current = 0;
    fallbackStreamDoneRef.current = false;
    fallbackSpeechBufferRef.current = "";
    window.speechSynthesis?.cancel();
    setVoice("THINKING");
    setCaption("JARVIS THINKING");

    try {
      const state = loadJarvisState();
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: state.messages.slice(-10).map(({ role, content }) => ({ role, content })),
          activeDomain: state.activeDomain,
          goals: state.goals,
          memories: state.memories.slice(-24).map(({ domain, fact }) => ({ domain, fact })),
        }),
      });
      if (!response.ok || !response.body) throw new Error("Jarvis intelligence unavailable.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullReply = "";
      let streamError = "";

      const consume = (block: string) => {
        let eventName = "message";
        let data = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) return;

        try {
          const payload = JSON.parse(data) as { text?: string; message?: string };
          if (eventName === "delta" && payload.text) {
            fullReply += payload.text;
            fallbackSpeechBufferRef.current += payload.text;
            flushFallbackBuffer(false);
          } else if (eventName === "error") {
            streamError = payload.message || "Jarvis intelligence unavailable.";
          }
        } catch {
          // Ignore malformed stream metadata and keep listening for usable text.
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          consume(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
        }
      }

      buffer += decoder.decode();
      if (buffer.trim()) consume(buffer);

      flushFallbackBuffer(true);
      fallbackStreamDoneRef.current = true;

      if (fullReply.trim()) {
        appendMessage("assistant", fullReply);
        finishFallbackIfReady();
        return;
      }

      throw new Error(streamError || "Jarvis intelligence returned no answer.");
    } catch {
      fallbackStreamDoneRef.current = true;
      fallbackSpeakingRef.current = false;
      const unavailable = "My intelligence provider is unavailable right now. Voice recognition is online, but I cannot answer general questions until the model connection is restored.";
      appendMessage("assistant", unavailable);
      queueFallbackSpeech(unavailable);
      setCaption("INTELLIGENCE PROVIDER UNAVAILABLE");
    }
  }

  function interruptFallbackSpeech() {
    speechGenerationRef.current += 1;
    try {
      elevenAudioRef.current?.pause();
    } catch {}
    elevenAudioRef.current = null;
    window.speechSynthesis?.cancel();
    premiumSpeechChainRef.current = Promise.resolve();
    fallbackPendingSpeechRef.current = 0;
    fallbackSpeechBufferRef.current = "";
    fallbackStreamDoneRef.current = true;
    fallbackSpeakingRef.current = false;
    fallbackArmedRef.current = true;
    setVoice("LISTENING");
    setCaption("LISTENING");
  }

  async function handleWakeTranscript(raw: string) {
    const transcript = raw.trim();
    if (!transcript || realtimeActiveRef.current || !voiceEnabledRef.current) return;

    const wakeMatch = transcript.match(/(?:^|\b)(?:(?:hey|okay|ok|yo)\s+)?jarvis\b[\s,:-]*(.*)$/i);
    const command = wakeMatch ? (wakeMatch[1]?.trim() ?? "") : transcript;

    if (fallbackSpeakingRef.current) {
      // While JARVIS speaks, only an explicit wake-word interruption is accepted.
      // This prevents his own speaker output from recursively triggering commands.
      if (!wakeMatch) return;
      interruptFallbackSpeech();
      if (!command || /^(?:stop|wait|hold on|quiet|cancel|never mind|nevermind)\b/i.test(command)) {
        return;
      }
    }

    if (!command) {
      fallbackArmedRef.current = true;
      setVoice("LISTENING");
      setCaption("LISTENING");
      return;
    }

    fallbackArmedRef.current = true;

    try {
      const desktop = await tryExecuteDesktopText(command);
      if (desktop) {
        appendMessage("user", command);
        stopWakeRecognition();
        fallbackPendingSpeechRef.current = 0;
        fallbackStreamDoneRef.current = true;
        fallbackSpeechBufferRef.current = "";
        window.speechSynthesis?.cancel();
        appendMessage("assistant", desktop.message);
        queueFallbackSpeech(desktop.message);
        return;
      }
    } catch {
      // Fall through to the intelligence path if local desktop routing fails.
    }

    await askFallback(command);
  }

  function buildWakeRecognition() {
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Recognition) return null;

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event: any) => {
      let interim = "";
      const finalParts: string[] = [];

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result?.[0]?.transcript ?? "";
        if (result.isFinal) finalParts.push(text);
        else interim += text;
      }

      if (finalParts.length) {
        pendingTranscriptRef.current = [pendingTranscriptRef.current, finalParts.join(" ")]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        if (pendingTranscriptTimerRef.current !== null) {
          window.clearTimeout(pendingTranscriptTimerRef.current);
        }

        pendingTranscriptTimerRef.current = window.setTimeout(() => {
          const fullThought = pendingTranscriptRef.current.trim();
          pendingTranscriptRef.current = "";
          pendingTranscriptTimerRef.current = null;
          if (fullThought) void handleWakeTranscript(fullThought);
        }, 280);
      }

      if (interim.trim() && !fallbackSpeakingRef.current && !realtimeActiveRef.current && voiceStateRef.current !== "THINKING") {
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
      restartWakeSoon(150);
    };
    recognition.onend = () => restartWakeSoon();
    return recognition;
  }

  function startVoice(isRestore = false) {
    if (voiceEnabledRef.current) return;

    const recognition = recognitionRef.current ?? buildWakeRecognition();
    if (recognition) recognitionRef.current = recognition;

    voiceEnabledRef.current = true;
    setVoiceEnabled(true);
    fallbackArmedRef.current = true;
    fallbackStreamDoneRef.current = true;
    window.localStorage.setItem(VOICE_STORAGE_KEY, "true");

    if (!recognitionRef.current) {
      setVoice("ERROR");
      setCaption("VOICE INPUT REQUIRES CHROME OR EDGE SPEECH SUPPORT");
      return;
    }

    setVoice("LISTENING");
    setCaption("CHECKING PREMIUM VOICE");
    void verifyPremiumVoice().then((verified) => {
      if (!voiceEnabledRef.current) return;
      if (verified) {
        window.setTimeout(() => {
          if (voiceEnabledRef.current && voiceStateRef.current === "LISTENING") {
            setCaption("VOICE ONLINE · ELEVENLABS");
          }
        }, 100);
      } else {
        setCaption("VOICE ONLINE · FALLBACK VOICE");
      }
    });

    try {
      recognitionRef.current.start();
    } catch {
      restartWakeSoon(isRestore ? 120 : 75);
    }
  }

  function stopVoice() {
    if (pendingTranscriptTimerRef.current !== null) {
      window.clearTimeout(pendingTranscriptTimerRef.current);
      pendingTranscriptTimerRef.current = null;
    }
    pendingTranscriptRef.current = "";
    voiceEnabledRef.current = false;
    setVoiceEnabled(false);
    fallbackArmedRef.current = false;
    fallbackSpeakingRef.current = false;
    fallbackStreamDoneRef.current = true;
    fallbackPendingSpeechRef.current = 0;
    window.localStorage.setItem(VOICE_STORAGE_KEY, "false");
    stopWakeRecognition();
    closeRealtime(false);
    window.speechSynthesis?.cancel();
    elevenAudioRef.current?.pause();
    elevenAudioRef.current = null;
    premiumSpeechChainRef.current = Promise.resolve();
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
    router.push("/work");
  }

  const value = useMemo<JarvisVoiceContextValue>(
    () => ({ voiceEnabled, voiceState, caption, fullscreen, toggleVoice, toggleFullscreen, goHome, goWork }),
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
        <button type="button" onClick={home ? goWork : goHome}>{home ? "WORK" : "HOME"}</button>
        <button type="button" className={fullscreen ? "active" : ""} onClick={() => void toggleFullscreen()}>
          {fullscreen ? "EXIT FULLSCREEN" : "FULLSCREEN"}
        </button>
      </div>
      {!home && voiceEnabled && (
        <div className={`jarvis-voice-status state-${voiceState.toLowerCase()}`}>
          <JarvisPresence state={voiceState} variant="mini" label="JARVIS" />
          <span>{voiceState}</span>
          <strong>{caption}</strong>
        </div>
      )}
    </JarvisVoiceContext.Provider>
  );
}
