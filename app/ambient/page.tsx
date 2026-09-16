"use client";

import { useEffect, useState } from "react";
import { useJarvisVoice } from "../jarvis-voice";
import "./ambient.css";

export default function AmbientPage() {
  const [time, setTime] = useState("--:--");
  const [date, setDate] = useState("--- --, ----");
  const { voiceEnabled, voiceState, caption, toggleVoice } = useJarvisVoice();

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

  return (
    <main className={`ambient-shell voice-${voiceState.toLowerCase()}`}>
      <div className="ambient-grid" />

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

      <button className={`voice-toggle ${voiceEnabled ? "enabled" : ""}`} type="button" onClick={toggleVoice}>
        <span className="voice-dot" /> {voiceEnabled ? "VOICE ACTIVE" : "ENABLE VOICE"}
      </button>
    </main>
  );
}
