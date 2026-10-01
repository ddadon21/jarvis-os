"use client";

import { useEffect, useRef } from "react";

export default function GoogleWorkspaceSync() {
  const busy = useRef(false);

  useEffect(() => {
    let disposed = false;

    async function sync(reason: string) {
      if (disposed || busy.current) return;
      busy.current = true;
      try {
        const statusResponse = await fetch("/api/integrations/google/status", { cache: "no-store" });
        if (!statusResponse.ok) return;
        const status = await statusResponse.json() as { connected?: boolean };
        if (!status.connected || disposed) return;

        const response = await fetch("/api/integrations/google/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (!response.ok) return;

        window.dispatchEvent(new CustomEvent("jarvis-google-sync", {
          detail: { state: "SYNCED", reason, at: new Date().toISOString() },
        }));
      } catch {
        window.dispatchEvent(new CustomEvent("jarvis-google-sync", {
          detail: { state: "DEGRADED", reason, at: new Date().toISOString() },
        }));
      } finally {
        busy.current = false;
      }
    }

    const startup = window.setTimeout(() => void sync("startup"), 1800);
    const timer = window.setInterval(() => void sync("scheduled"), 5 * 60_000);
    const onFocus = () => void sync("focus");
    const onManual = () => void sync("manual");

    window.addEventListener("focus", onFocus);
    window.addEventListener("jarvis-google-sync-now", onManual);

    return () => {
      disposed = true;
      window.clearTimeout(startup);
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("jarvis-google-sync-now", onManual);
    };
  }, []);

  return null;
}
