"use client";

import { useEffect, useState } from "react";

type ClockValue = {
  time: string;
  date: string;
};

function currentClock(seconds: boolean): ClockValue {
  const now = new Date();
  return {
    time: now.toLocaleTimeString([], seconds
      ? { hour12: false }
      : { hour: "2-digit", minute: "2-digit", hour12: false }),
    date: now.toLocaleDateString([], seconds
      ? { month: "short", day: "2-digit", year: "numeric" }
      : { weekday: "long", month: "long", day: "numeric", year: "numeric" }).toUpperCase(),
  };
}

export default function JarvisLocalClock({ variant }: { variant: "topbar" | "ambient" }) {
  const seconds = variant === "topbar";
  const [clock, setClock] = useState<ClockValue>(() => currentClock(seconds));

  useEffect(() => {
    const update = () => setClock(currentClock(seconds));
    update();
    const interval = window.setInterval(update, seconds ? 1000 : 30_000);
    return () => window.clearInterval(interval);
  }, [seconds]);

  if (variant === "ambient") {
    return (
      <>
        <div className="ambient-time">{clock.time}</div>
        <div className="ambient-date">{clock.date}</div>
      </>
    );
  }

  return (
    <>
      <div className="status-block"><span>LOCAL DATE</span><b>{clock.date}</b></div>
      <div className="status-block"><span>LOCAL TIME</span><b>{clock.time}</b></div>
    </>
  );
}
