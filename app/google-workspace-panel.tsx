"use client";

import { CalendarDays, Check, Mail, RefreshCw, Unplug } from "lucide-react";
import { useEffect, useState } from "react";

type GoogleStatus = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  updatedAt: string | null;
};

export default function GoogleWorkspacePanel() {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("CHECKING GOOGLE WORKSPACE");

  async function refresh() {
    try {
      const response = await fetch("/api/integrations/google/status", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const next = await response.json() as GoogleStatus;
      setStatus(next);
      setMessage(
        next.connected
          ? "CALENDAR + GMAIL CONNECTED"
          : next.configured
            ? "AUTHORIZATION READY"
            : "OAUTH APP SETUP REQUIRED",
      );
    } catch {
      setMessage("GOOGLE STATUS UNAVAILABLE");
    }
  }

  useEffect(() => {
    void refresh();
    const onSync = () => void refresh();
    window.addEventListener("jarvis-google-sync", onSync);
    return () => window.removeEventListener("jarvis-google-sync", onSync);
  }, []);

  function connect() {
    window.location.assign("/api/integrations/google/connect");
  }

  async function syncNow() {
    if (!status?.connected || busy) return;
    setBusy(true);
    setMessage("SYNCING CALENDAR + GMAIL");
    try {
      const response = await fetch("/api/integrations/google/sync", { method: "POST" });
      if (!response.ok) throw new Error();
      window.dispatchEvent(new CustomEvent("jarvis-google-sync", {
        detail: { state: "SYNCED", reason: "manual", at: new Date().toISOString() },
      }));
      await refresh();
    } catch {
      setMessage("GOOGLE SYNC DEGRADED");
    } finally {
      setBusy(false);
    }
  }

  const connected = status?.connected === true;
  const configured = status?.configured === true;

  return (
    <div className={`google-workspace-card ${connected ? "is-connected" : configured ? "is-ready" : "is-setup"}`}>
      <div className="google-workspace-head">
        <span className="google-workspace-icon">
          {busy ? <RefreshCw size={12} className="google-workspace-spin" /> : connected ? <Check size={12} /> : <Unplug size={12} />}
        </span>
        <div>
          <strong>{message}</strong>
          <small>{connected ? status?.email || "AUTHORIZED ACCOUNT" : configured ? "ONE-TIME GOOGLE CONSENT REQUIRED" : "ADD GOOGLE OAUTH CREDENTIALS"}</small>
        </div>
      </div>

      <div className="google-workspace-signals">
        <span><CalendarDays size={10} /> CALENDAR</span>
        <span><Mail size={10} /> GMAIL</span>
      </div>

      <div className="google-workspace-actions">
        {!connected ? (
          <button type="button" disabled={!configured} onClick={connect}>
            {configured ? "CONNECT GOOGLE" : "SETUP REQUIRED"}
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={() => void syncNow()}>
            {busy ? "SYNCING…" : "SYNC NOW"}
          </button>
        )}
      </div>
    </div>
  );
}
