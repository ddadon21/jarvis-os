"use client";

import { BookOpen, Check, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type BridgeState = "UNPAIRED" | "READY" | "WORKING" | "ONLINE" | "ERROR";

type CommandResult = {
  id: string;
  action: "LIST" | "READ" | "WRITE" | "SEARCH";
  ok: boolean;
  path: string | null;
  data: string | null;
  error: string | null;
  completedAt: string;
};

function controllerToken() {
  return window.localStorage.getItem("jarvis-observer-controller-v1") ?? "";
}

async function waitForResult(token: string, id: string) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    await new Promise(resolve => window.setTimeout(resolve, 550));
    const response = await fetch(`/api/obsidian/command?id=${encodeURIComponent(id)}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("Local Agent command status unavailable.");
    const payload = await response.json() as { pending?: boolean; result?: CommandResult | null };
    if (payload.result?.id === id) return payload.result;
  }
  throw new Error("Local Agent did not answer in time.");
}

export default function ObsidianBridgePanel() {
  const [state, setState] = useState<BridgeState>("UNPAIRED");
  const [message, setMessage] = useState("PAIR LOCAL AGENT");
  const [detail, setDetail] = useState("Obsidian stays local to this PC.");
  const [files, setFiles] = useState<string[]>([]);
  const [query, setQuery] = useState("JARVIS");
  const [searchPreview, setSearchPreview] = useState("");
  const [syncDetail, setSyncDetail] = useState("Automatic knowledge sync ready.");

  useEffect(() => {
    let cancelled = false;

    async function checkLink() {
      const token = controllerToken();
      if (!token) {
        if (!cancelled) {
          setState("UNPAIRED");
          setMessage("PAIR LOCAL AGENT");
          setDetail("Pair the Windows Local Agent in Trading.");
        }
        return;
      }

      try {
        const response = await fetch("/api/trading/link/status", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error();
        const payload = await response.json() as { link?: { online?: boolean; observerVersion?: string | null } };
        if (cancelled) return;
        if (payload.link?.online) {
          setState(current => current === "ONLINE" ? current : "READY");
          setMessage(current => current === "VAULT ONLINE" ? current : "LOCAL AGENT READY");
          setDetail(`Agent ${payload.link.observerVersion ?? "connected"} · Obsidian bridge available`);
        } else {
          setState("ERROR");
          setMessage("LOCAL AGENT OFFLINE");
          setDetail("Local Agent is paired but JARVIS is waiting for its heartbeat.");
        }
      } catch {
        if (!cancelled) {
          setState("ERROR");
          setMessage("LOCAL AGENT UNAVAILABLE");
          setDetail("Pair or restart the Windows Local Agent.");
        }
      }
    }

    void checkLink();
    const timer = window.setInterval(checkLink, 1500);
    const refresh = () => void checkLink();
    window.addEventListener("storage", refresh);
    window.addEventListener("jarvis-observer-link-updated", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("jarvis-observer-link-updated", refresh);
    };
  }, []);

  useEffect(() => {
    const onSyncStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      if (detail?.message) setSyncDetail(detail.message);
    };
    window.addEventListener("jarvis-obsidian-sync-status", onSyncStatus);
    return () => window.removeEventListener("jarvis-obsidian-sync-status", onSyncStatus);
  }, []);

  async function run(action: "LIST" | "WRITE" | "SEARCH") {
    const token = controllerToken();
    if (!token) {
      setState("UNPAIRED");
      setMessage("PAIR LOCAL AGENT");
      return;
    }

    setState("WORKING");
    setMessage(action === "LIST" ? "READING VAULT…" : action === "SEARCH" ? "SEARCHING VAULT…" : "WRITING TEST NOTE…");
    setDetail("JARVIS Cloud → Local Agent → Obsidian");

    try {
      const body = action === "LIST"
        ? { action: "LIST" as const, path: null }
        : action === "SEARCH"
          ? { action: "SEARCH" as const, query: query.trim() || "JARVIS" }
          : {
              action: "WRITE" as const,
              path: "00 Inbox/JARVIS Cloud Bridge Test.md",
              content: [
                "# JARVIS Cloud Bridge Test",
                "",
                `Connected: ${new Date().toLocaleString()}`,
                "",
                "Route: JARVIS Cloud → Windows Local Agent → Obsidian",
                "",
                "Status: ONLINE",
              ].join("\n"),
            };

      const response = await fetch("/api/obsidian/command", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("Could not send command to Local Agent.");
      const payload = await response.json() as { command?: { id?: string } };
      if (!payload.command?.id) throw new Error("Local Agent command was not created.");

      const result = await waitForResult(token, payload.command.id);
      if (!result.ok) throw new Error(result.error || "Obsidian command failed.");

      if (action === "LIST") {
        try {
          const parsed = JSON.parse(result.data ?? "{}") as { files?: string[] };
          const nextFiles = Array.isArray(parsed.files) ? parsed.files : [];
          setFiles(nextFiles);
          setDetail(`${nextFiles.length} vault item${nextFiles.length === 1 ? "" : "s"} visible through Local Agent`);
        } catch {
          setDetail("Vault responded through Local Agent.");
        }
      } else if (action === "SEARCH") {
        setSearchPreview((result.data ?? "").slice(0, 220));
        setDetail(`Search returned through Local Agent for “${query.trim() || "JARVIS"}”.`);
      } else {
        setDetail("00 Inbox/JARVIS Cloud Bridge Test.md created.");
      }

      setState("ONLINE");
      setMessage("VAULT ONLINE");
    } catch (error) {
      setState("ERROR");
      setMessage("BRIDGE ERROR");
      setDetail(error instanceof Error ? error.message : "Obsidian bridge failed.");
    }
  }

  const icon = useMemo(() => {
    if (state === "WORKING") return <RefreshCw size={11} className="obsidian-spin" />;
    if (state === "ONLINE") return <Check size={11} />;
    if (state === "ERROR") return <X size={11} />;
    return <BookOpen size={11} />;
  }, [state]);

  return (
    <div className={`obsidian-bridge is-${state.toLowerCase()}`}>
      <div className="obsidian-bridge-state">
        <span>{icon}</span>
        <div>
          <b>{message}</b>
          <small>{detail}</small>
        </div>
      </div>
      <div className="obsidian-bridge-actions">
        <button type="button" disabled={state === "WORKING" || state === "UNPAIRED"} onClick={() => void run("LIST")}>TEST VAULT</button>
        <button type="button" disabled={state === "WORKING" || state === "UNPAIRED"} onClick={() => void run("WRITE")}>WRITE TEST</button>
        <button type="button" disabled={state === "UNPAIRED"} onClick={() => window.dispatchEvent(new Event("jarvis-obsidian-sync-now"))}>SYNC NOW</button>
      </div>
      <small className="obsidian-bridge-sync">{syncDetail}</small>
      <div className="obsidian-bridge-search">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="SEARCH KNOWLEDGE" />
        <button type="button" disabled={state === "WORKING" || state === "UNPAIRED"} onClick={() => void run("SEARCH")}>SEARCH</button>
      </div>
      {files.length ? <small className="obsidian-bridge-files">{files.slice(0, 4).join(" · ")}</small> : null}
      {searchPreview ? <small className="obsidian-bridge-search-result">{searchPreview}</small> : null}
    </div>
  );
}
