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

const LOCAL_BACKUP_PREFIX = "local.";
const SENSITIVE_LOCAL_KEYS = new Set([
  "jarvis-observer-controller-v1",
  // Managed by the dedicated durable Obsidian outbox, not generic local-key backup.
  "jarvis-obsidian-outbox-v1",
]);

function shouldBackupLocalKey(key: string) {
  if (!key.startsWith("jarvis-")) return false;
  if (SENSITIVE_LOCAL_KEYS.has(key)) return false;
  const normalized = key.toLowerCase();
  return !["token", "secret", "password", "credential", "controller", "device-token", "session"].some((part) => normalized.includes(part));
}

function discoverBackupLocalKeys() {
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key && shouldBackupLocalKey(key) && !CLOUD_KEYS.includes(key as CloudKey)) keys.push(key);
  }
  return [...new Set(keys)].sort();
}

function snapshotKeyForLocal(key: string) {
  return `${LOCAL_BACKUP_PREFIX}${key}`;
}

function localKeyFromSnapshot(stateKey: string) {
  return stateKey.startsWith(LOCAL_BACKUP_PREFIX) ? stateKey.slice(LOCAL_BACKUP_PREFIX.length) : null;
}

const RUNTIME_KEYS = {
  system: "runtime.system-status.v1",
  finance: "runtime.finance.v1",
  workforce: "runtime.workforce.v1",
  trading: "runtime.trading.v1",
  pulse: "runtime.pulse.v1",
} as const;

const ALL_RUNTIME_KEYS = Object.values(RUNTIME_KEYS);

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

type RuntimeTrade = {
  id?: string;
  externalId?: string | null;
  symbol?: string;
  side?: "LONG" | "SHORT";
  quantity?: number;
  status?: "OPEN" | "CLOSED";
  entryPrice?: number | null;
  exitPrice?: number | null;
  stopPrice?: number | null;
  targetPrice?: number | null;
  openedAt?: string;
  closedAt?: string | null;
  realizedPnl?: number | null;
  fees?: number | null;
  source?: string;
  setup?: string | null;
  notes?: string | null;
};

type TradingState = {
  account?: {
    connection?: string;
    lastObservedAt?: string | null;
    accountLabel?: string;
  };
  openTrades?: RuntimeTrade[];
  recentTrades?: RuntimeTrade[];
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

function runtimePayload(data: unknown) {
  return { format: "runtime-json", data };
}

function payloadRuntimeData(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as { format?: unknown; data?: unknown };
  return candidate.format === "runtime-json" ? candidate.data ?? null : null;
}

function payloadRaw(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const raw = (payload as { raw?: unknown }).raw;
  return typeof raw === "string" ? raw : null;
}

function payloadDeleted(payload: unknown) {
  return Boolean(payload && typeof payload === "object" && (payload as { deleted?: unknown }).deleted === true);
}

function dispatchRestored(key: string) {
  if (key === "jarvis-os-state-v1") window.dispatchEvent(new Event("jarvis-state-updated"));
  if (key === "jarvis-life-command-v2" || key === "jarvis-life-plan-v1") window.dispatchEvent(new Event("jarvis-life-updated"));
  if (key === "jarvis-habit-history-v1") window.dispatchEvent(new Event("jarvis-habits-updated"));
  window.dispatchEvent(new CustomEvent("jarvis-cloud-state-restored", { detail: { key } }));
}

function goalKey(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100) || "goal";
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function markPersistence(
  supabase: ReturnType<typeof getSupabaseBrowserClient>,
  workspaceId: string,
  domain: "CORE" | "TRADING" | "FINANCE" | "LIFE" | "SENTRYOPS",
  component: string,
  detail: Record<string, unknown> = {},
) {
  await supabase
    .from("jarvis_persistence_status")
    .upsert({
      workspace_id: workspaceId,
      domain,
      component,
      last_success_at: new Date().toISOString(),
      detail,
    }, { onConflict: "workspace_id,domain,component" });
}

export default function JarvisCloudBridge() {
  const [status, setStatus] = useState<"OFFLINE" | "CONNECTING" | "SYNCED" | "ERROR">("OFFLINE");
  const workspaceRef = useRef<string | null>(null);
  const readyRef = useRef(false);
  const lastRawRef = useRef<Record<string, string | null>>({});
  const syncingRef = useRef(false);
  const observerSeenRef = useRef<string | null>(null);
  const runtimeFingerprintsRef = useRef<Record<string, string>>({});

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
        .eq("workspace_id", workspaceId);

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

      for (const [stateKey, row] of remote.entries()) {
        const localKey = localKeyFromSnapshot(stateKey);
        if (!localKey || !shouldBackupLocalKey(localKey)) continue;
        const cloudRaw = payloadRaw(row.payload);
        const isDeleted = payloadDeleted(row.payload);
        const localRaw = window.localStorage.getItem(localKey);

        if (isDeleted) {
          if (localRaw != null) window.localStorage.removeItem(localKey);
          lastRawRef.current[stateKey] = null;
        } else if (cloudRaw != null) {
          if (localRaw !== cloudRaw) window.localStorage.setItem(localKey, cloudRaw);
          lastRawRef.current[stateKey] = cloudRaw;
          dispatchRestored(localKey);
        }
      }

      for (const localKey of discoverBackupLocalKeys()) {
        const stateKey = snapshotKeyForLocal(localKey);
        if (remote.has(stateKey)) continue;
        const localRaw = window.localStorage.getItem(localKey);
        if (localRaw == null) continue;
        toUpload.push({
          workspace_id: workspaceId,
          state_key: stateKey,
          version: 1,
          payload: rawPayload(localRaw),
          source: "JARVIS LOCAL SAFETY BACKUP",
          client_updated_at: new Date().toISOString(),
        });
        lastRawRef.current[stateKey] = localRaw;
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

      try {
        const runtimeByKey = new Map<string, unknown>();
        for (const key of ALL_RUNTIME_KEYS) {
          const row = remote.get(key);
          if (!row) continue;
          const data = payloadRuntimeData(row.payload);
          if (data != null) runtimeByKey.set(key, data);
        }

        const { data: eventRows } = await supabase
          .from("jarvis_events")
          .select("id,domain,event_type,source,importance,summary,payload,occurred_at,created_at")
          .eq("workspace_id", workspaceId)
          .order("occurred_at", { ascending: false })
          .limit(75);

        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (accessToken && runtimeByKey.size) {
          await fetch("/api/system/restore", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              finance: runtimeByKey.get(RUNTIME_KEYS.finance) ?? null,
              workforce: runtimeByKey.get(RUNTIME_KEYS.workforce) ?? null,
              trading: runtimeByKey.get(RUNTIME_KEYS.trading) ?? null,
              pulse: runtimeByKey.get(RUNTIME_KEYS.pulse) ?? null,
              events: (eventRows ?? []).map((row) => ({
                id: row.id,
                type: row.event_type,
                domain: row.domain,
                source: row.source,
                importance: row.importance,
                occurredAt: row.occurred_at,
                receivedAt: row.payload && typeof row.payload === "object" && "receivedAt" in row.payload
                  ? (row.payload as { receivedAt?: string }).receivedAt ?? row.created_at
                  : row.created_at,
                summary: row.summary,
              })),
            }),
          });
        }
      } catch {
        // Cloud snapshots remain safe even if the temporary runtime cache cannot be restored immediately.
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
      const dynamicKeys = new Set(discoverBackupLocalKeys());
      for (const stateKey of Object.keys(lastRawRef.current)) {
        const localKey = localKeyFromSnapshot(stateKey);
        if (localKey && shouldBackupLocalKey(localKey)) dynamicKeys.add(localKey);
      }

      const localPairs = [
        ...CLOUD_KEYS.map((key) => ({ localKey: key, stateKey: key, source: "JARVIS CLIENT" })),
        ...[...dynamicKeys].map((localKey) => ({
          localKey,
          stateKey: snapshotKeyForLocal(localKey),
          source: "JARVIS LOCAL SAFETY BACKUP",
        })),
      ];

      for (const { localKey, stateKey, source } of localPairs) {
        const raw = window.localStorage.getItem(localKey);
        if (raw === lastRawRef.current[stateKey]) continue;
        lastRawRef.current[stateKey] = raw;

        changed.push({
          workspace_id: workspaceId,
          state_key: stateKey,
          version: 1,
          payload: raw == null ? deletedPayload() : rawPayload(raw),
          source: raw == null ? "JARVIS CLIENT DELETE" : source,
          client_updated_at: new Date().toISOString(),
        });
      }

      if (!changed.length) return;
      syncingRef.current = true;
      const { error } = await supabase
        .from("jarvis_state_snapshots")
        .upsert(changed, { onConflict: "workspace_id,state_key" });
      syncingRef.current = false;
      if (!error) await markPersistence(supabase, workspaceId, "CORE", "client-state", { snapshots: changed.length });
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

    async function syncCoreHistory() {
      const workspaceId = workspaceRef.current;
      if (!readyRef.current || !workspaceId) return;
      const raw = window.localStorage.getItem("jarvis-os-state-v1");
      if (!raw) return;

      try {
        const parsed = JSON.parse(raw) as {
          messages?: Array<{ role?: string; content?: string; createdAt?: string }>;
          memories?: Array<{ id?: string; domain?: string; fact?: string; createdAt?: string }>;
        };

        const messages = (parsed.messages ?? [])
          .filter((message) => (message.role === "user" || message.role === "assistant") && typeof message.content === "string" && message.content.trim())
          .map((message) => ({
            workspace_id: workspaceId,
            client_key: `msg:${message.createdAt ?? "undated"}:${stableHash(`${message.role}|${message.content}`)}`,
            role: message.role,
            content: message.content,
            message_created_at: message.createdAt && Number.isFinite(Date.parse(message.createdAt)) ? message.createdAt : null,
            metadata: { persistedBy: "jarvis-cloud-bridge" },
          }));

        if (messages.length) {
          await supabase
            .from("jarvis_chat_messages")
            .upsert(messages, { onConflict: "workspace_id,client_key", ignoreDuplicates: true });
        }

        const memories = (parsed.memories ?? [])
          .filter((memory) => typeof memory.id === "string" && typeof memory.fact === "string" && memory.fact.trim())
          .map((memory) => ({
            workspace_id: workspaceId,
            client_id: memory.id,
            domain: memory.domain || "CORE",
            fact: memory.fact,
            memory_created_at: memory.createdAt && Number.isFinite(Date.parse(memory.createdAt)) ? memory.createdAt : null,
            metadata: { persistedBy: "jarvis-cloud-bridge" },
          }));

        if (memories.length) {
          await supabase
            .from("jarvis_memories")
            .upsert(memories, { onConflict: "workspace_id,client_id" });
        }

        await markPersistence(supabase, workspaceId, "CORE", "chat-memory", {
          messages: messages.length,
          memories: memories.length,
        });
      } catch {
        // History remains in the state snapshot and retries later.
      }
    }

    void syncCoreHistory();
    const timer = window.setInterval(() => void syncCoreHistory(), 5000);
    window.addEventListener("focus", syncCoreHistory);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", syncCoreHistory);
    };
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    async function syncLifeStructured() {
      const workspaceId = workspaceRef.current;
      if (!readyRef.current || !workspaceId) return;
      const raw = window.localStorage.getItem("jarvis-life-command-v2") ?? window.localStorage.getItem("jarvis-life-plan-v1");
      if (!raw) return;

      try {
        const plan = JSON.parse(raw) as {
          days?: Record<string, {
            priorities?: unknown[];
            blocks?: Record<string, boolean>;
            win?: string;
            lesson?: string;
            tomorrow?: string;
            focusMinutes?: number;
            intelligenceIndex?: number;
          }>;
          missions?: Array<{
            id?: string;
            sourceId?: string;
            pillar?: string;
            title?: string;
            detail?: string;
            minutes?: number;
            date?: string;
            time?: string;
            done?: boolean;
            evidence?: string;
            completedOn?: string;
          }>;
        };

        const dayRows = Object.entries(plan.days ?? {})
          .filter(([day]) => /^\d{4}-\d{2}-\d{2}$/.test(day))
          .map(([day, value]) => ({
            workspace_id: workspaceId,
            day,
            priorities: Array.isArray(value.priorities) ? value.priorities : [],
            blocks: value.blocks && typeof value.blocks === "object" ? value.blocks : {},
            win: typeof value.win === "string" ? value.win : "",
            lesson: typeof value.lesson === "string" ? value.lesson : "",
            tomorrow: typeof value.tomorrow === "string" ? value.tomorrow : "",
            focus_minutes: Math.max(0, Math.round(Number(value.focusMinutes) || 0)),
            intelligence_index: Number.isInteger(value.intelligenceIndex) ? value.intelligenceIndex : null,
          }));

        if (dayRows.length) {
          await supabase.from("life_days").upsert(dayRows, { onConflict: "workspace_id,day" });
        }

        const missions = (plan.missions ?? []).filter((mission) =>
          typeof mission.id === "string" &&
          typeof mission.title === "string" &&
          typeof mission.date === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(mission.date)
        );

        if (missions.length) {
          await supabase.from("life_missions").upsert(missions.map((mission) => ({
            workspace_id: workspaceId,
            client_id: String(mission.id),
            source_id: typeof mission.sourceId === "string" ? mission.sourceId : null,
            pillar: typeof mission.pillar === "string" ? mission.pillar : "experiences",
            title: String(mission.title),
            detail: typeof mission.detail === "string" ? mission.detail : "",
            minutes: Math.max(0, Math.round(Number(mission.minutes) || 0)),
            mission_date: String(mission.date),
            mission_time: typeof mission.time === "string" ? mission.time : "",
            done: Boolean(mission.done),
            evidence: typeof mission.evidence === "string" ? mission.evidence : "",
            completed_on: typeof mission.completedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(mission.completedOn) ? mission.completedOn : null,
          })), { onConflict: "workspace_id,client_id" });
        }

        const clientIds = missions.map((mission) => String(mission.id));
        let deleteQuery = supabase.from("life_missions").delete().eq("workspace_id", workspaceId);
        if (clientIds.length) deleteQuery = deleteQuery.not("client_id", "in", `(${clientIds.map((id) => `"${id.replace(/"/g, "")}"`).join(",")})`);
        await deleteQuery;

        await markPersistence(supabase, workspaceId, "LIFE", "plan", {
          days: dayRows.length,
          missions: missions.length,
        });
      } catch {
        // Raw Life state and its revisions remain the recovery source if structured sync needs to retry.
      }
    }

    void syncLifeStructured();
    const timer = window.setInterval(() => void syncLifeStructured(), 5000);
    const listener = () => { void syncLifeStructured(); };
    window.addEventListener("jarvis-life-updated", listener);
    window.addEventListener("focus", listener);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("jarvis-life-updated", listener);
      window.removeEventListener("focus", listener);
    };
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    async function syncLifeHabits() {
      const workspaceId = workspaceRef.current;
      if (!readyRef.current || !workspaceId) return;
      const raw = window.localStorage.getItem("jarvis-habit-history-v1");
      if (!raw) return;

      try {
        const store = JSON.parse(raw) as {
          days?: Record<string, Record<string, boolean>>;
          tradingDays?: Record<string, true>;
        };
        const dates = new Set([
          ...Object.keys(store.days ?? {}),
          ...Object.keys(store.tradingDays ?? {}),
        ]);
        const rows = [...dates]
          .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day))
          .map((day) => ({
            workspace_id: workspaceId,
            day,
            habits: store.days?.[day] ?? {},
            trading_day: Boolean(store.tradingDays?.[day]),
          }));

        if (rows.length) {
          await supabase.from("life_habit_days").upsert(rows, { onConflict: "workspace_id,day" });
        }
        await markPersistence(supabase, workspaceId, "LIFE", "habits", { days: rows.length });
      } catch {
        // Raw habit snapshot remains available and this retries later.
      }
    }

    void syncLifeHabits();
    const timer = window.setInterval(() => void syncLifeHabits(), 5000);
    const listener = () => { void syncLifeHabits(); };
    window.addEventListener("jarvis-habits-updated", listener);
    window.addEventListener("focus", listener);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("jarvis-habits-updated", listener);
      window.removeEventListener("focus", listener);
    };
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    async function saveRuntimeSnapshot(stateKey: string, data: unknown) {
      const workspaceId = workspaceRef.current;
      if (!readyRef.current || !workspaceId || data == null) return;

      let fingerprint = "";
      try {
        fingerprint = JSON.stringify(data);
      } catch {
        return;
      }
      if (runtimeFingerprintsRef.current[stateKey] === fingerprint) return;
      runtimeFingerprintsRef.current[stateKey] = fingerprint;

      await supabase
        .from("jarvis_state_snapshots")
        .upsert({
          workspace_id: workspaceId,
          state_key: stateKey,
          version: 1,
          payload: runtimePayload(data),
          source: "JARVIS RUNTIME BRIDGE",
          client_updated_at: new Date().toISOString(),
        }, { onConflict: "workspace_id,state_key" });
    }

    async function syncRuntimeEvents() {
      const workspaceId = workspaceRef.current;
      if (!readyRef.current || !workspaceId) return;

      try {
        const response = await fetch("/api/system/status", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as {
          events?: RuntimeEvent[];
          workforce?: unknown;
          backgroundResearch?: { latestPulse?: unknown };
          [key: string]: unknown;
        };

        await saveRuntimeSnapshot(RUNTIME_KEYS.system, body);
        if (body.workforce) await saveRuntimeSnapshot(RUNTIME_KEYS.workforce, body.workforce);
        if (body.backgroundResearch?.latestPulse) await saveRuntimeSnapshot(RUNTIME_KEYS.pulse, body.backgroundResearch.latestPulse);

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

        if (rows.length) {
          await supabase
            .from("jarvis_events")
            .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
        }

        await markPersistence(supabase, workspaceId, "CORE", "runtime-events", { events: rows.length });

        const coreRaw = window.localStorage.getItem("jarvis-os-state-v1");
        let sentryCore: Record<string, unknown> = {};
        if (coreRaw) {
          try {
            const core = JSON.parse(coreRaw) as {
              activeDomain?: string;
              memories?: Array<{ id?: string; domain?: string; fact?: string; createdAt?: string }>;
              goals?: unknown[];
              nextMove?: { domain?: string; title?: string; reason?: string };
            };
            sentryCore = {
              activeDomain: core.activeDomain ?? null,
              memories: (core.memories ?? []).filter((memory) => memory.domain === "SENTRYOPS"),
              goals: core.goals ?? [],
              nextMove: core.nextMove?.domain === "SENTRYOPS" ? core.nextMove : null,
            };
          } catch {
            sentryCore = {};
          }
        }

        const workforce = body.workforce && typeof body.workforce === "object"
          ? body.workforce as { status?: string; lastCycleAt?: string | null; executiveSummary?: string }
          : {};
        const pulse = body.backgroundResearch?.latestPulse && typeof body.backgroundResearch.latestPulse === "object"
          ? body.backgroundResearch.latestPulse as { ranAt?: string; status?: string; summary?: string }
          : null;
        const sentryRuntime = { workforce, latestPulse: pulse };
        const sentryFingerprint = stableHash(JSON.stringify({ sentryCore, sentryRuntime }));

        await supabase.from("sentryops_state_history").upsert({
          workspace_id: workspaceId,
          fingerprint: sentryFingerprint,
          observed_at: new Date().toISOString(),
          workforce_status: workforce.status ?? null,
          executive_summary: workforce.executiveSummary ?? null,
          pulse_ran_at: pulse?.ranAt && Number.isFinite(Date.parse(pulse.ranAt)) ? pulse.ranAt : null,
          pulse_status: pulse?.status ?? null,
          pulse_summary: pulse?.summary ?? null,
          core_payload: sentryCore,
          runtime_payload: sentryRuntime,
        }, { onConflict: "workspace_id,fingerprint", ignoreDuplicates: true });

        await markPersistence(supabase, workspaceId, "SENTRYOPS", "workspace-state", {
          workforceStatus: workforce.status ?? null,
          hasPulse: Boolean(pulse),
        });
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

    async function syncFinanceRuntime() {
      const workspaceId = workspaceRef.current;
      if (!readyRef.current || !workspaceId) return;
      try {
        const response = await fetch("/api/finance/state", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { state?: unknown };
        if (!body.state) return;

        const fingerprint = JSON.stringify(body.state);
        if (runtimeFingerprintsRef.current[RUNTIME_KEYS.finance] === fingerprint) return;
        runtimeFingerprintsRef.current[RUNTIME_KEYS.finance] = fingerprint;

        await supabase
          .from("jarvis_state_snapshots")
          .upsert({
            workspace_id: workspaceId,
            state_key: RUNTIME_KEYS.finance,
            version: 1,
            payload: runtimePayload(body.state),
            source: "JARVIS FINANCE RUNTIME",
            client_updated_at: new Date().toISOString(),
          }, { onConflict: "workspace_id,state_key" });

        const financeState = body.state as {
          asOf?: string;
          source?: string;
          mode?: string;
          accountCount?: number;
          metrics?: {
            personalNetWorth?: number;
            providerNetWorth?: number;
            liquidity?: number;
            investmentValue?: number;
            personalDebt?: number;
          };
        };
        await supabase.from("finance_state_history").upsert({
          workspace_id: workspaceId,
          fingerprint: stableHash(fingerprint),
          as_of: financeState.asOf && Number.isFinite(Date.parse(financeState.asOf)) ? financeState.asOf : null,
          source: financeState.source ?? null,
          mode: financeState.mode ?? null,
          personal_net_worth: financeState.metrics?.personalNetWorth ?? null,
          provider_net_worth: financeState.metrics?.providerNetWorth ?? null,
          liquidity: financeState.metrics?.liquidity ?? null,
          investment_value: financeState.metrics?.investmentValue ?? null,
          personal_debt: financeState.metrics?.personalDebt ?? null,
          account_count: financeState.accountCount ?? null,
          payload: body.state,
        }, { onConflict: "workspace_id,fingerprint", ignoreDuplicates: true });

        await markPersistence(supabase, workspaceId, "FINANCE", "runtime", {
          asOf: financeState.asOf ?? null,
          accountCount: financeState.accountCount ?? null,
        });
      } catch {
        // Retry on the next interval.
      }
    }

    void syncFinanceRuntime();
    const timer = window.setInterval(() => void syncFinanceRuntime(), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    async function syncFinancePlan() {
      const workspaceId = workspaceRef.current;
      if (!readyRef.current || !workspaceId) return;
      const raw = window.localStorage.getItem("jarvis-finance-payout-plan-v1");
      if (!raw) return;

      try {
        const plan = JSON.parse(raw) as Record<string, unknown>;
        await supabase.from("finance_plans").upsert({
          workspace_id: workspaceId,
          plan_key: "payout-plan",
          payload: plan,
        }, { onConflict: "workspace_id,plan_key" });

        await markPersistence(supabase, workspaceId, "FINANCE", "payout-plan", {
          fields: Object.keys(plan).length,
        });
      } catch {
        // Raw finance-plan snapshot remains available and this retries later.
      }
    }

    void syncFinancePlan();
    const timer = window.setInterval(() => void syncFinancePlan(), 5000);
    const listener = () => { void syncFinancePlan(); };
    window.addEventListener("focus", listener);
    window.addEventListener("storage", listener);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", listener);
      window.removeEventListener("storage", listener);
    };
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
        if (!state) return;

        const tradingFingerprint = JSON.stringify(state);
        if (runtimeFingerprintsRef.current[RUNTIME_KEYS.trading] !== tradingFingerprint) {
          runtimeFingerprintsRef.current[RUNTIME_KEYS.trading] = tradingFingerprint;
          await supabase
            .from("jarvis_state_snapshots")
            .upsert({
              workspace_id: workspaceId,
              state_key: RUNTIME_KEYS.trading,
              version: 1,
              payload: runtimePayload(state),
              source: "JARVIS TRADING RUNTIME",
              client_updated_at: new Date().toISOString(),
            }, { onConflict: "workspace_id,state_key" });
        }

        const allTrades = [...(state.openTrades ?? []), ...(state.recentTrades ?? [])]
          .filter((trade) => trade.id && trade.symbol && trade.side && trade.status && trade.openedAt);

        if (allTrades.length) {
          const { data: selectedSetting } = await supabase
            .from("jarvis_settings")
            .select("value")
            .eq("workspace_id", workspaceId)
            .eq("scope", "TRADING")
            .eq("key", "selected_account")
            .maybeSingle();
          const selectedClientId = selectedSetting?.value && typeof selectedSetting.value === "object"
            ? String((selectedSetting.value as { clientId?: string }).clientId ?? "")
            : "";

          let accountQuery = supabase
            .from("trading_accounts")
            .select("id")
            .eq("workspace_id", workspaceId)
            .neq("status", "ARCHIVED");
          if (selectedClientId) accountQuery = accountQuery.eq("client_id", selectedClientId);
          const { data: accountRows } = await accountQuery.limit(1);
          const accountId = accountRows?.[0]?.id ? String(accountRows[0].id) : null;

          if (accountId) {
            const tradeRows = allTrades.map((trade) => ({
              workspace_id: workspaceId,
              account_id: accountId,
              runtime_trade_id: String(trade.id),
              external_trade_id: trade.externalId ?? null,
              symbol: String(trade.symbol),
              side: trade.side,
              quantity: trade.quantity ?? 0,
              status: trade.status,
              entry_price: trade.entryPrice ?? null,
              exit_price: trade.exitPrice ?? null,
              stop_price: trade.stopPrice ?? null,
              target_price: trade.targetPrice ?? null,
              realized_pnl: trade.realizedPnl ?? null,
              fees: trade.fees ?? null,
              opened_at: trade.openedAt,
              closed_at: trade.closedAt ?? null,
              setup: trade.setup ?? null,
              notes: trade.notes ?? null,
              source: trade.source || "JARVIS OBSERVER",
              metadata: { persistedBy: "jarvis-cloud-bridge" },
            }));
            await supabase.from("trades").upsert(tradeRows, { onConflict: "workspace_id,runtime_trade_id" });
          }
        }

        await markPersistence(supabase, workspaceId, "TRADING", "runtime", {
          connection: state.account?.connection ?? null,
          openTrades: state.openTrades?.length ?? 0,
          recentTrades: state.recentTrades?.length ?? 0,
        });

        const observer = state.observer;
        const observedAt = observer?.observedAt || state.account?.lastObservedAt || null;
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

      if (["CORE", "TRADING", "FINANCE", "LIFE", "SENTRYOPS"].includes(domain)) {
        await markPersistence(
          supabase,
          workspaceId,
          domain as "CORE" | "TRADING" | "FINANCE" | "LIFE" | "SENTRYOPS",
          "goals",
          { goals: rows.length },
        );
      }
    }

    const listener = (event: Event) => { void onGoals(event); };
    window.addEventListener("jarvis-goal-readiness", listener);
    return () => window.removeEventListener("jarvis-goal-readiness", listener);
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    async function runPersistenceAudit() {
      const workspaceId = workspaceRef.current;
      if (!readyRef.current || !workspaceId) return;

      try {
        const [
          tradingAccounts,
          tradingDays,
          payouts,
          tradeAttachments,
          financeHistory,
          financePlans,
          lifeDays,
          lifeMissions,
          lifeHabits,
          sentryHistory,
          snapshots,
          revisions,
        ] = await Promise.all([
          supabase.from("trading_accounts").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
          supabase.from("trading_days").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
          supabase.from("trading_payouts").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
          supabase.from("jarvis_attachments").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("domain", "TRADING"),
          supabase.from("finance_state_history").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
          supabase.from("finance_plans").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
          supabase.from("life_days").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
          supabase.from("life_missions").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
          supabase.from("life_habit_days").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
          supabase.from("sentryops_state_history").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
          supabase.from("jarvis_state_snapshots").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
          supabase.from("jarvis_state_revisions").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
        ]);

        await Promise.all([
          markPersistence(supabase, workspaceId, "TRADING", "structured-audit", {
            accounts: tradingAccounts.count ?? 0,
            days: tradingDays.count ?? 0,
            payouts: payouts.count ?? 0,
            attachments: tradeAttachments.count ?? 0,
          }),
          markPersistence(supabase, workspaceId, "FINANCE", "structured-audit", {
            history: financeHistory.count ?? 0,
            plans: financePlans.count ?? 0,
          }),
          markPersistence(supabase, workspaceId, "LIFE", "structured-audit", {
            days: lifeDays.count ?? 0,
            missions: lifeMissions.count ?? 0,
            habitDays: lifeHabits.count ?? 0,
          }),
          markPersistence(supabase, workspaceId, "SENTRYOPS", "structured-audit", {
            history: sentryHistory.count ?? 0,
          }),
          markPersistence(supabase, workspaceId, "CORE", "revision-audit", {
            snapshots: snapshots.count ?? 0,
            revisions: revisions.count ?? 0,
          }),
        ]);
      } catch {
        // The next audit run retries without interrupting Jarvis.
      }
    }

    void runPersistenceAudit();
    const timer = window.setInterval(() => void runPersistenceAudit(), 60_000);
    window.addEventListener("focus", runPersistenceAudit);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", runPersistenceAudit);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.jarvisCloud = status.toLowerCase();
    return () => {
      delete document.documentElement.dataset.jarvisCloud;
    };
  }, [status]);

  return null;
}
