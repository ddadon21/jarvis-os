"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "../lib/supabase-browser";

const CLOUD_KEYS = [
  "jarvis-os-state-v1",
  "jarvis-life-command-v2",
  "jarvis-life-plan-v1",
  "jarvis-habit-history-v1",
  "jarvis-finance-payout-plan-v1",
  "jarvis-voice-enabled-v1",
] as const;

type CloudKey = typeof CLOUD_KEYS[number];

type RuntimeEvent = {
  id?: string;
  type?: string;
  domain?: string;
  source?: string;
  importance?: string;
  occurredAt?: string;
  receivedAt?: string;
  summary?: string;
};

type GoalReadinessEvent = CustomEvent<{
  domain?: string;
  goals?: Array<{
    name?: string;
    status?: string;
    detail?: string;
    progress?: number | null;
    active?: boolean;
  }>;
}>;

type TradingState = {
  account?: {
    connection?: string;
    lastObservedAt?: string | null;
  };
  observer?: {
    status?: string;
    intentState?: string;
    symbol?: string | null;
    side?: string | null;
    quantity?: number | null;
    orderType?: string | null;
    entryPrice?: number | null;
    currentPrice?: number | null;
    stopPrice?: number | null;
    targetPrice?: number | null;
    openPnl?: number | null;
    confidence?: number | null;
    observedAt?: string | null;
    evidence?: string[];
  } | null;
};

function rawPayload(raw: string) {
  return { format: "localStorage", raw, deleted: false };
}

function deletedPayload() {
  return { format: "localStorage", raw: null, deleted: true };
}

function payloadRaw(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const raw = (payload as { raw?: unknown }).raw;
  return typeof raw === "string" ? raw : null;
}

function payloadDeleted(payload: unknown) {
  return Boolean(payload && typeof payload === "object" && (payload as { deleted?: unknown }).deleted === true);
}

function dispatchRestored(key: CloudKey) {
  if (key === "jarvis-os-state-v1") window.dispatchEvent(new Event("jarvis-state-updated"));
  if (key === "jarvis-life-command-v2" || key === "jarvis-life-plan-v1") window.dispatchEvent(new Event("jarvis-life-updated"));
  if (key === "jarvis-habit-history-v1") window.dispatchEvent(new Event("jarvis-habits-updated"));
  window.dispatchEvent(new CustomEvent("jarvis-cloud-state-restored", { detail: { key } }));
}

function goalKey(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100) || "goal";
}

export default function JarvisCloudBridge() {
  const [status, setStatus] = useState<"OFFLINE" | "CONNECTING" | "SYNCED" | "ERROR">("OFFLINE");
  const workspaceRef = useRef<string | null>(null);
  const readyRef = useRef(false);
  const lastRawRef = useRef<Record<string, string | null>>({});
  const syncingRef = useRef(false);
  const observerSeenRef = useRef<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let active = true;

    async function connect() {
      setStatus("CONNECTING");
      const { data: userData } = await supabase.auth.getUser();
      if (!active) return;
      const user = userData.user;
      if (!user) {
        workspaceRef.current = null;
        readyRef.current = false;
        setStatus("OFFLINE");
        return;
      }

      const { data: workspace, error: workspaceError } = await supabase
        .from("jarvis_workspaces")
        .select("id")
        .eq("slug", "primary")
        .maybeSingle();

      if (!active) return;
      if (workspaceError || !workspace?.id) {
        setStatus("ERROR");
        return;
      }

      const workspaceId = String(workspace.id);
      workspaceRef.current = workspaceId;

      const { data: remoteRows, error: remoteError } = await supabase
        .from("jarvis_state_snapshots")
        .select("state_key,payload,updated_at")
        .eq("workspace_id", workspaceId)
        .in("state_key", [...CLOUD_KEYS]);

      if (!active) return;
      if (remoteError) {
        setStatus("ERROR");
        return;
      }

      const remote = new Map((remoteRows ?? []).map((row) => [String(row.state_key), row]));
      const toUpload: Array<Record<string, unknown>> = [];

      for (const key of CLOUD_KEYS) {
        const row = remote.get(key);
        const cloudRaw = row ? payloadRaw(row.payload) : null;
        const isDeleted = row ? payloadDeleted(row.payload) : false;
        const localRaw = window.localStorage.getItem(key);

        if (isDeleted) {
          if (localRaw != null) {
            window.localStorage.removeItem(key);
            dispatchRestored(key);
          }
          lastRawRef.current[key] = null;
        } else if (cloudRaw != null) {
          if (localRaw !== cloudRaw) {
            window.localStorage.setItem(key, cloudRaw);
            dispatchRestored(key);
          }
          lastRawRef.current[key] = cloudRaw;
        } else if (localRaw != null) {
          toUpload.push({
            workspace_id: workspaceId,
            state_key: key,
            version: 1,
            payload: rawPayload(localRaw),
            source: "JARVIS CLIENT MIGRATION",
            client_updated_at: new Date().toISOString(),
          });
          lastRawRef.current[key] = localRaw;
        } else {
          lastRawRef.current[key] = null;
        }
      }

      if (toUpload.length) {
        const { error } = await supabase
          .from("jarvis_state_snapshots")
          .upsert(toUpload, { onConflict: "workspace_id,state_key" });
        if (error) {
          setStatus("ERROR");
          return;
        }
      }

      readyRef.current = true;
      setStatus("SYNCED");
      window.dispatchEvent(new CustomEvent("jarvis-cloud-ready", { detail: { workspaceId } }));
    }

    void connect();

    const { data: authListener } = supabase.auth.onAuthStateChange(() => {
      readyRef.current = false;
      void connect();
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    async function syncLocalState() {
      const workspaceId = workspaceRef.current;
      if (!readyRef.current || !workspaceId || syncingRef.current) return;

      const changed: Array<Record<string, unknown>> = [];
      for (const key of CLOUD_KEYS) {
        const raw = window.localStorage.getItem(key);
        if (raw === lastRawRef.current[key]) continue;
        lastRawRef.current[key] = raw;

        changed.push({
          workspace_id: workspaceId,
          state_key: key,
          version: 1,
          payload: raw == null ? deletedPayload() : rawPayload(raw),
          source: raw == null ? "JARVIS CLIENT DELETE" : "JARVIS CLIENT",
          client_updated_at: new Date().toISOString(),
        });
      }

      if (!changed.length) return;
      syncingRef.current = true;
      const { error } = await supabase
        .from("jarvis_state_snapshots")
        .upsert(changed, { onConflict: "workspace_id,state_key" });
      syncingRef.current = false;
      setStatus(error ? "ERROR" : "SYNCED");
    }

    const customSync = () => { void syncLocalState(); };
    const storageSync = (event: StorageEvent) => {
      if (!event.key || CLOUD_KEYS.includes(event.key as CloudKey)) void syncLocalState();
    };

    const timer = window.setInterval(() => void syncLocalState(), 3000);
    window.addEventListener("storage", storageSync);
    window.addEventListener("focus", customSync);
    window.addEventListener("jarvis-state-updated", customSync);
    window.addEventListener("jarvis-life-updated", customSync);
    window.addEventListener("jarvis-habits-updated", customSync);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", storageSync);
      window.removeEventListener("focus", customSync);
      window.removeEventListener("jarvis-state-updated", customSync);
      window.removeEventListener("jarvis-life-updated", customSync);
      window.removeEventListener("jarvis-habits-updated", customSync);
    };
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    async function syncRuntimeEvents() {
      const workspaceId = workspaceRef.current;
      if (!readyRef.current || !workspaceId) return;

      try {
        const response = await fetch("/api/system/status", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { events?: RuntimeEvent[] };
        const rows = (body.events ?? [])
          .filter((event) => event.id && event.type && event.summary)
          .map((event) => ({
            id: event.id,
            workspace_id: workspaceId,
            domain: event.domain || "CORE",
            event_type: event.type,
            source: event.source || "jarvis.runtime",
            importance: event.importance || "NORMAL",
            summary: event.summary,
            payload: {
              receivedAt: event.receivedAt ?? null,
              persistedBy: "jarvis-cloud-bridge",
            },
            occurred_at: event.occurredAt || new Date().toISOString(),
          }));

        if (!rows.length) return;
        await supabase
          .from("jarvis_events")
          .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
      } catch {
        // Runtime history persistence is best-effort and retries on the next interval.
      }
    }

    void syncRuntimeEvents();
    const timer = window.setInterval(() => void syncRuntimeEvents(), 10000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    async function syncObserverSnapshot() {
      const workspaceId = workspaceRef.current;
      if (!readyRef.current || !workspaceId) return;

      try {
        const response = await fetch("/api/trading/state", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { state?: TradingState };
        const state = body.state;
        const observer = state?.observer;
        const observedAt = observer?.observedAt || state?.account?.lastObservedAt || null;
        if (!observer || !observedAt || observedAt === observerSeenRef.current) return;

        observerSeenRef.current = observedAt;
        await supabase.from("trading_observer_snapshots").upsert({
          workspace_id: workspaceId,
          observed_at: observedAt,
          connection: state?.account?.connection ?? null,
          status: observer.status ?? null,
          intent_state: observer.intentState ?? null,
          symbol: observer.symbol ?? null,
          side: observer.side ?? null,
          quantity: observer.quantity ?? null,
          order_type: observer.orderType ?? null,
          entry_price: observer.entryPrice ?? null,
          current_price: observer.currentPrice ?? null,
          stop_price: observer.stopPrice ?? null,
          target_price: observer.targetPrice ?? null,
          open_pnl: observer.openPnl ?? null,
          confidence: observer.confidence ?? null,
          evidence: observer.evidence ?? [],
          payload: { persistedBy: "jarvis-cloud-bridge" },
          source: "JARVIS OBSERVER",
        }, { onConflict: "workspace_id,observed_at", ignoreDuplicates: true });
      } catch {
        // Observer persistence retries automatically while Jarvis is open.
      }
    }

    void syncObserverSnapshot();
    const timer = window.setInterval(() => void syncObserverSnapshot(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    async function onGoals(event: Event) {
      const workspaceId = workspaceRef.current;
      if (!readyRef.current || !workspaceId) return;

      const detail = (event as GoalReadinessEvent).detail;
      const domain = detail?.domain?.toUpperCase();
      const goals = Array.isArray(detail?.goals) ? detail.goals : [];
      if (!domain || !goals.length) return;

      const rows = goals
        .filter((goal) => typeof goal.name === "string" && goal.name.trim())
        .map((goal) => ({
          workspace_id: workspaceId,
          domain,
          client_key: goalKey(goal.name as string),
          name: goal.name,
          status: goal.status || "ACTIVE",
          progress: typeof goal.progress === "number" ? goal.progress : null,
          detail: goal.detail || null,
          source: "JARVIS GOAL READINESS",
          metadata: { active: Boolean(goal.active) },
        }));

      if (!rows.length) return;
      await supabase
        .from("jarvis_goals")
        .upsert(rows, { onConflict: "workspace_id,domain,client_key" });
    }

    const listener = (event: Event) => { void onGoals(event); };
    window.addEventListener("jarvis-goal-readiness", listener);
    return () => window.removeEventListener("jarvis-goal-readiness", listener);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.jarvisCloud = status.toLowerCase();
    return () => {
      delete document.documentElement.dataset.jarvisCloud;
    };
  }, [status]);

  return null;
}
