"use client";

import { useEffect } from "react";

export default function PerformanceGovernor() {
  useEffect(() => {
    const root = document.documentElement;
    let stopTimer = 0;
    let scrolling = false;

    const markScrolling = () => {
      if (!scrolling) {
        scrolling = true;
        root.dataset.jarvisScrolling = "true";
      }
      window.clearTimeout(stopTimer);
      stopTimer = window.setTimeout(() => {
        scrolling = false;
        delete root.dataset.jarvisScrolling;
      }, 120);
    };

    const handleVisibility = () => {
      if (document.hidden) root.dataset.jarvisHidden = "true";
      else delete root.dataset.jarvisHidden;
    };

    const concurrency = navigator.hardwareConcurrency || 8;
    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    if (concurrency <= 4 || deviceMemory <= 4) root.dataset.jarvisPerformance = "lean";

    window.addEventListener("scroll", markScrolling, { passive: true, capture: true });
    document.addEventListener("visibilitychange", handleVisibility);
    handleVisibility();

    return () => {
      window.removeEventListener("scroll", markScrolling, true);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearTimeout(stopTimer);
      delete root.dataset.jarvisScrolling;
      delete root.dataset.jarvisHidden;
    };
  }, []);

  return null;
}
