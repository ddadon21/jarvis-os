"use client";

import { useJarvisVoice } from "../jarvis-voice";
import JarvisPresence from "../jarvis-presence";
import JarvisLocalClock from "../jarvis-local-clock";
import "./ambient.css";

export default function AmbientPage() {
  const { voiceState, caption } = useJarvisVoice();

  return (
    <main className={`ambient-shell voice-${voiceState.toLowerCase()}`}>
      <div className="ambient-grid" />

      <div className="ambient-identity">
        <strong>HIMIE JOHNSON VENTURES</strong>
        <span>DWIGHT // FOUNDER & OPERATOR</span>
      </div>

      <section className="ambient-center" aria-live="polite">
        <div className="jarvis-ambient-presence">
          <JarvisPresence state={voiceState} variant="hero" label="JARVIS" />
        </div>

        <JarvisLocalClock variant="ambient" />
        <div className="ambient-caption">{caption}</div>
      </section>

    </main>
  );
}
