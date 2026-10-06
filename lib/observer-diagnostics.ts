import { durableRead, durableWrite } from "./jarvis-db";

/**
 * Week-one Observer reliability evidence (SOP-006), uploaded by the Local Agent
 * as a cumulative daily snapshot. Stored as one jarvis_settings row per day
 * (scope OBSERVER, key diagnostics:<day>), so the latest upload wins and seven
 * days of history stay available for the end-of-week review.
 */

export const OBSERVER_DIAGNOSTIC_FIELDS = ["symbol", "direction", "contracts", "orderType", "entry", "current", "stop", "target"] as const;

export type ObserverSymbolStats = { activeReads: number; completeReads: number; episodes: number; fills: number; suspect: number };

export type ObserverDiagnostics = {
  day: string;
  deviceId: string | null;
  observerVersion: string;
  generatedAt: string;
  receivedAt: string;
  reads: number;
  readMsP50: number | null;
  readMsP95: number | null;
  activeReads: number;
  missingFieldRate: Record<string, number | null>;
  titleComparableReads: number;
  wrongSymbolRate: number | null;
  suspectedFalseOrderEvents: number;
  suspectedFalseTrades: number;
  cancelClears: number;
  cancelClearMsP50: number | null;
  cancelClearMsP95: number | null;
  fillConfirmMsP50: number | null;
  fillConfirmMsP95: number | null;
  transitions: Record<string, number>;
  perSymbol: Record<string, ObserverSymbolStats>;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SYMBOL = /^[A-Z0-9!]{1,12}$/;
const TRANSITION = /^[A-Z_]{4,20}>[A-Z_]{4,20}$/;

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), 10_000_000) : 0;
}

function measure(value: unknown, max = 600_000): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? Math.round(value * 10) / 10 : null;
}

function rate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? Math.round(value * 10_000) / 10_000 : null;
}

/** Validates an upload; returns null when it is not a diagnostics snapshot. */
export function normalizeObserverDiagnostics(input: unknown, deviceId: string | null, receivedAt = new Date().toISOString()): ObserverDiagnostics | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const day = typeof raw.day === "string" && DAY.test(raw.day) ? raw.day : null;
  if (!day) return null;
  const generatedAt = typeof raw.generatedAt === "string" && Number.isFinite(Date.parse(raw.generatedAt)) ? new Date(raw.generatedAt).toISOString() : receivedAt;

  const missing: Record<string, number | null> = {};
  const rawMissing = raw.missingFieldRate && typeof raw.missingFieldRate === "object" ? raw.missingFieldRate as Record<string, unknown> : {};
  for (const field of OBSERVER_DIAGNOSTIC_FIELDS) missing[field] = rate(rawMissing[field]);

  const transitions: Record<string, number> = {};
  const rawTransitions = raw.transitions && typeof raw.transitions === "object" ? raw.transitions as Record<string, unknown> : {};
  for (const [key, value] of Object.entries(rawTransitions).slice(0, 40)) if (TRANSITION.test(key)) transitions[key] = count(value);

  const perSymbol: Record<string, ObserverSymbolStats> = {};
  const rawSymbols = raw.perSymbol && typeof raw.perSymbol === "object" ? raw.perSymbol as Record<string, unknown> : {};
  for (const [symbol, value] of Object.entries(rawSymbols).slice(0, 40)) {
    if (!SYMBOL.test(symbol) || !value || typeof value !== "object") continue;
    const stats = value as Record<string, unknown>;
    perSymbol[symbol] = {
      activeReads: count(stats.activeReads),
      completeReads: count(stats.completeReads),
      episodes: count(stats.episodes),
      fills: count(stats.fills),
      suspect: count(stats.suspect),
    };
  }

  return {
    day,
    deviceId,
    observerVersion: typeof raw.observerVersion === "string" ? raw.observerVersion.slice(0, 20) : "",
    generatedAt,
    receivedAt,
    reads: count(raw.reads),
    readMsP50: measure(raw.readMsP50),
    readMsP95: measure(raw.readMsP95),
    activeReads: count(raw.activeReads),
    missingFieldRate: missing,
    titleComparableReads: count(raw.titleComparableReads),
    wrongSymbolRate: rate(raw.wrongSymbolRate),
    suspectedFalseOrderEvents: count(raw.suspectedFalseOrderEvents),
    suspectedFalseTrades: count(raw.suspectedFalseTrades),
    cancelClears: count(raw.cancelClears),
    cancelClearMsP50: measure(raw.cancelClearMsP50),
    cancelClearMsP95: measure(raw.cancelClearMsP95),
    fillConfirmMsP50: measure(raw.fillConfirmMsP50),
    fillConfirmMsP95: measure(raw.fillConfirmMsP95),
    transitions,
    perSymbol,
  };
}

let latestCache: { at: number; value: ObserverDiagnostics | null } | null = null;
const LATEST_CACHE_MS = 30_000;

export async function saveObserverDiagnostics(diagnostics: ObserverDiagnostics): Promise<boolean> {
  latestCache = null;
  return durableWrite("jarvis_settings", ({ db, workspaceId }) =>
    db.from("jarvis_settings").upsert(
      { workspace_id: workspaceId, scope: "OBSERVER", key: "diagnostics:" + diagnostics.day, value: diagnostics },
      { onConflict: "workspace_id,scope,key" },
    ),
  );
}

/** Today's (most recent) snapshot for the trading state poll, cached for 30 s. */
export async function latestObserverDiagnostics(): Promise<ObserverDiagnostics | null> {
  if (latestCache && Date.now() - latestCache.at < LATEST_CACHE_MS) return latestCache.value;
  const [latest] = await listObserverDiagnostics(1);
  latestCache = { at: Date.now(), value: latest ?? null };
  return latestCache.value;
}

/** Most recent daily snapshots, newest first. */
export async function listObserverDiagnostics(limit = 7): Promise<ObserverDiagnostics[]> {
  const rows = await durableRead<Array<{ value: unknown }>>("jarvis_settings", ({ db, workspaceId }) =>
    db.from("jarvis_settings").select("value").eq("workspace_id", workspaceId).eq("scope", "OBSERVER")
      .like("key", "diagnostics:%").order("key", { ascending: false }).limit(limit),
  );
  return (rows ?? [])
    .map((row) => normalizeObserverDiagnostics(row.value, (row.value as { deviceId?: string } | null)?.deviceId ?? null, (row.value as { receivedAt?: string } | null)?.receivedAt))
    .filter((value): value is ObserverDiagnostics => value !== null);
}
