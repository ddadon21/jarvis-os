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

function dispatchRestored(key: CloudKey) {
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
        .eq("workspace_id", workspaceId)
        .in("state_key", [...CLOUD_KEYS, ...ALL_RUNTIME_KEYS]);

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
          .map((message, index) => ({
            workspace_id: workspaceId,
            client_key: `msg:${message.createdAt ?? "undated"}:${stableHash(`${message.role}|${message.content}|${index}`)}`,
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
