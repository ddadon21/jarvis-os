import { createHash, randomBytes } from "node:crypto";
import { getCache } from "@vercel/functions";
import { durableContext } from "./jarvis-db";

/**
 * Local Agent link: pairing, heartbeat, and the command queue between JARVIS
 * Cloud and the Windows Local Agent.
 *
 * - Pairing lives in Supabase (jarvis_devices) so a cache eviction or the old
 *   90-day TTL can no longer silently unpair the Observer. Runtime Cache is a
 *   fast copy.
 * - Commands are a queue (jarvis_device_commands), one row per command, so a
 *   new command never overwrites an unacknowledged one and a heartbeat write
 *   can never erase a queued command.
 * - Commands that sit unclaimed for 15 minutes expire instead of running
 *   unexpectedly later.
 */

export type ObserverCommand = "WATCH" | "PAUSE";

export type LocalAgentObsidianAction = "LIST" | "READ" | "WRITE" | "SEARCH";

export type LocalAgentDesktopAction =
  | "GET_CONTEXT"
  | "SCREEN_CAPTURE"
  | "OPEN_APP"
  | "FOCUS_WINDOW"
  | "OPEN_PATH"
  | "OPEN_URI"
  | "CLIPBOARD_READ"
  | "CLIPBOARD_WRITE"
  | "UI_CLICK_TEXT"
  | "UI_TYPE_TEXT"
  | "BROWSER_READ_PAGE"
  | "BROWSER_NAVIGATE"
  | "BROWSER_SEARCH"
  | "BROWSER_BACK"
  | "RUN_CODING_AGENT"
  | "RUN_APPROVED_COMMAND";

export type LocalAgentDesktopCommand = {
  id: string;
  action: LocalAgentDesktopAction;
  target: string | null;
  text: string | null;
  args: string[];
  createdAt: string;
  authorization: "READ_ONLY" | "USER_AUTHORIZED";
};

export type LocalAgentDesktopResult = {
  id: string;
  action: LocalAgentDesktopAction;
  ok: boolean;
  summary: string;
  data: string | null;
  evidence: string[];
  error: string | null;
  completedAt: string;
};

export type LocalAgentObsidianCommand = {
  id: string;
  action: LocalAgentObsidianAction;
  path: string | null;
  content: string | null;
  query: string | null;
  createdAt: string;
};

export type LocalAgentObsidianResult = {
  id: string;
  action: LocalAgentObsidianAction;
  ok: boolean;
  path: string | null;
  data: string | null;
  error: string | null;
  completedAt: string;
};

export type ObserverDeviceLink = {
  version: 1;
  deviceId: string;
  deviceName: string;
  deviceTokenHash: string;
  controllerTokenHash: string;
  pairedAt: string;
  lastHeartbeatAt: string | null;
  lastFrameAt: string | null;
  command: ObserverCommand;
  observerVersion: string | null;
  agentCapabilities?: string[];
};

type CommandKind = "DESKTOP" | "OBSIDIAN";
type QueuedCommand = LocalAgentDesktopCommand | LocalAgentObsidianCommand;
type CommandResult = LocalAgentDesktopResult | LocalAgentObsidianResult;

type PendingPair = {
  deviceId: string;
  deviceName: string;
  deviceTokenHash: string;
  createdAt: string;
  expiresAt: string;
};

const PAIR_TTL_SECONDS = 10 * 60;
const DEVICE_TTL_SECONDS = 60 * 60 * 24 * 90;
const LOCAL_AGENT_PRESENCE_KEY = "jarvis:local-agent:presence:v1";
const COMMAND_EXPIRY_MS = 15 * 60_000;
const DURABLE_HEARTBEAT_MS = 30_000;
const MAX_QUEUE = 20;
const MAX_RESULTS = 20;

const lastDurableHeartbeat = new Map<string, number>();

function pairKey(code: string) { return `jarvis:trading:pair:${normalizeCode(code)}`; }
function deviceKey(deviceId: string) { return `jarvis:trading:device:${deviceId}`; }
function controllerKey(hash: string) { return `jarvis:trading:controller:${hash}`; }
function queueKey(deviceId: string, kind: CommandKind) { return `jarvis:device:${deviceId}:queue:${kind}`; }
function resultsKey(deviceId: string, kind: CommandKind) { return `jarvis:device:${deviceId}:results:${kind}`; }

function normalizeCode(value: string) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

function token(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function pairingCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    return (await getCache().get(key)) as T | null;
  } catch {
    return null;
  }
}

async function cacheSet(key: string, value: unknown, ttl = DEVICE_TTL_SECONDS, tags = ["jarvis-trading-device"]) {
  try {
    await getCache().set(key, value, { ttl, tags });
  } catch {
    // Durable storage remains the source of truth.
  }
}

/* ------------------------------------------------------------------ */
/* Link persistence                                                    */
/* ------------------------------------------------------------------ */

type DeviceRow = {
  device_id: string;
  device_name: string;
  device_token_hash: string;
  controller_token_hash: string | null;
  paired_at: string;
  last_heartbeat_at: string | null;
  last_frame_at: string | null;
  command: string;
  observer_version: string | null;
  capabilities: unknown;
  revoked_at: string | null;
};

function rowToLink(row: DeviceRow): ObserverDeviceLink | null {
  if (row.revoked_at || !row.controller_token_hash) return null;
  return {
    version: 1,
    deviceId: row.device_id,
    deviceName: row.device_name,
    deviceTokenHash: row.device_token_hash,
    controllerTokenHash: row.controller_token_hash,
    pairedAt: row.paired_at,
    lastHeartbeatAt: row.last_heartbeat_at,
    lastFrameAt: row.last_frame_at,
    command: row.command === "WATCH" ? "WATCH" : "PAUSE",
    observerVersion: row.observer_version,
    agentCapabilities: Array.isArray(row.capabilities) ? row.capabilities.map(String) : [],
  };
}

async function loadDurableLink(column: "device_id" | "controller_token_hash", value: string): Promise<ObserverDeviceLink | null> {
  const ctx = await durableContext();
  if (!ctx) return null;
  try {
    const { data, error } = await ctx.db.from("jarvis_devices")
      .select("device_id,device_name,device_token_hash,controller_token_hash,paired_at,last_heartbeat_at,last_frame_at,command,observer_version,capabilities,revoked_at")
      .eq("workspace_id", ctx.workspaceId)
      .eq(column, value)
      .maybeSingle();
    if (error || !data) return null;
    return rowToLink(data as DeviceRow);
  } catch {
    return null;
  }
}

async function saveDurableLink(link: ObserverDeviceLink) {
  const ctx = await durableContext();
  if (!ctx) return;
  try {
    await ctx.db.from("jarvis_devices").upsert({
      device_id: link.deviceId,
      workspace_id: ctx.workspaceId,
      device_name: link.deviceName,
      device_token_hash: link.deviceTokenHash,
      controller_token_hash: link.controllerTokenHash,
      paired_at: link.pairedAt,
      last_heartbeat_at: link.lastHeartbeatAt,
      last_frame_at: link.lastFrameAt,
      command: link.command,
      observer_version: link.observerVersion,
      capabilities: link.agentCapabilities ?? [],
    }, { onConflict: "device_id" });
    lastDurableHeartbeat.set(link.deviceId, Date.now());
  } catch {
    // Cache copy keeps the link usable; next durable save retries.
  }
}

async function loadLink(deviceId: string): Promise<ObserverDeviceLink | null> {
  const cached = await cacheGet<ObserverDeviceLink>(deviceKey(deviceId));
  if (cached) return cached;
  const durable = await loadDurableLink("device_id", deviceId);
  if (durable) await cacheSet(deviceKey(deviceId), durable);
  return durable;
}

async function saveLink(link: ObserverDeviceLink, durable: "always" | "throttled" | "never") {
  await cacheSet(deviceKey(link.deviceId), link);
  const last = lastDurableHeartbeat.get(link.deviceId) ?? 0;
  if (durable === "always" || (durable === "throttled" && Date.now() - last >= DURABLE_HEARTBEAT_MS)) {
    await saveDurableLink(link);
  }
}

/* ------------------------------------------------------------------ */
/* Pairing                                                             */
/* ------------------------------------------------------------------ */

export async function startObserverPairing(deviceName = "Dwight Windows PC") {
  const deviceId = `obs_${token(12)}`;
  const deviceToken = token(32);
  const code = pairingCode();
  const now = new Date();
  const expires = new Date(now.getTime() + PAIR_TTL_SECONDS * 1000);
  const pending: PendingPair = {
    deviceId,
    deviceName: String(deviceName || "Windows PC").slice(0, 80),
    deviceTokenHash: hash(deviceToken),
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };

  await getCache().set(pairKey(code), pending, { ttl: PAIR_TTL_SECONDS, tags: ["jarvis-trading-pairing"] });
  return { code, deviceId, deviceToken, expiresAt: pending.expiresAt };
}

export async function confirmObserverPairing(code: string) {
  const normalized = normalizeCode(code);
  if (normalized.length < 6) return null;
  const pending = await cacheGet<PendingPair>(pairKey(normalized));
  if (!pending || Date.parse(pending.expiresAt) <= Date.now()) return null;

  const controllerToken = token(32);
  const controllerTokenHash = hash(controllerToken);
  const link: ObserverDeviceLink = {
    version: 1,
    deviceId: pending.deviceId,
    deviceName: pending.deviceName,
    deviceTokenHash: pending.deviceTokenHash,
    controllerTokenHash,
    pairedAt: new Date().toISOString(),
    lastHeartbeatAt: null,
    lastFrameAt: null,
    command: "PAUSE",
    observerVersion: null,
    agentCapabilities: [],
  };

  await Promise.all([
    saveLink(link, "always"),
    cacheSet(controllerKey(controllerTokenHash), { deviceId: link.deviceId }),
  ]);

  try {
    await getCache().set(pairKey(normalized), { ...pending, expiresAt: new Date(0).toISOString() }, { ttl: 1, tags: ["jarvis-trading-pairing"] });
  } catch {
    // The code still expires naturally within PAIR_TTL_SECONDS.
  }

  return {
    controllerToken,
    deviceId: link.deviceId,
    deviceName: link.deviceName,
    command: link.command,
    pairedAt: link.pairedAt,
  };
}

export async function authenticateObserverDevice(deviceId: string | null, deviceToken: string | null) {
  if (!deviceId || !deviceToken) return null;
  const link = await loadLink(deviceId);
  if (!link || link.deviceTokenHash !== hash(deviceToken)) return null;
  return link;
}

async function resolveController(controllerToken: string | null) {
  if (!controllerToken) return null;
  const controllerTokenHash = hash(controllerToken);
  const mapping = await cacheGet<{ deviceId?: string }>(controllerKey(controllerTokenHash));
  let link = mapping?.deviceId ? await loadLink(mapping.deviceId) : null;
  if (!link) link = await loadDurableLink("controller_token_hash", controllerTokenHash);
  if (!link || link.controllerTokenHash !== controllerTokenHash) return null;
  // Sliding renewal: an actively used controller never ages out.
  await cacheSet(controllerKey(controllerTokenHash), { deviceId: link.deviceId });
  return link;
}

/* ------------------------------------------------------------------ */
/* Command queue                                                       */
/* ------------------------------------------------------------------ */

type CommandRow = {
  id: string;
  action: string;
  payload: Record<string, unknown>;
  authorization_level: string;
  status: string;
  created_at: string;
  result: unknown;
};

function rowToCommand(kind: CommandKind, row: CommandRow): QueuedCommand {
  const payload = row.payload ?? {};
  if (kind === "OBSIDIAN") {
    return {
      id: row.id,
      action: row.action as LocalAgentObsidianAction,
      path: (payload.path as string | null) ?? null,
      content: (payload.content as string | null) ?? null,
      query: (payload.query as string | null) ?? null,
      createdAt: row.created_at,
    };
  }
  return {
    id: row.id,
    action: row.action as LocalAgentDesktopAction,
    target: (payload.target as string | null) ?? null,
    text: (payload.text as string | null) ?? null,
    args: Array.isArray(payload.args) ? (payload.args as unknown[]).map(String) : [],
    createdAt: row.created_at,
    authorization: row.authorization_level === "USER_AUTHORIZED" ? "USER_AUTHORIZED" : "READ_ONLY",
  };
}

function commandPayload(command: QueuedCommand): Record<string, unknown> {
  if ("query" in command) return { path: command.path, content: command.content, query: command.query };
  return { target: command.target, text: command.text, args: command.args };
}

async function enqueue(link: ObserverDeviceLink, kind: CommandKind, command: QueuedCommand) {
  const ctx = await durableContext();
  if (ctx) {
    const { error } = await ctx.db.from("jarvis_device_commands").insert({
      id: command.id,
      workspace_id: ctx.workspaceId,
      device_id: link.deviceId,
      kind,
      action: command.action,
      payload: commandPayload(command),
      authorization_level: "authorization" in command ? command.authorization : "READ_ONLY",
      status: "PENDING",
      created_at: command.createdAt,
    });
    if (!error) return true;
    console.warn("[device-link] durable enqueue failed, using cache queue:", error.message);
  }
  const queue = (await cacheGet<QueuedCommand[]>(queueKey(link.deviceId, kind))) ?? [];
  await cacheSet(queueKey(link.deviceId, kind), [...queue, command].slice(-MAX_QUEUE), 60 * 60);
  return true;
}

/** Next command to hand the agent. Re-delivers a claimed command until its result arrives. */
async function nextCommand(deviceId: string, kind: CommandKind): Promise<QueuedCommand | null> {
  const now = Date.now();
  const ctx = await durableContext();
  if (ctx) {
    try {
      const { data, error } = await ctx.db.from("jarvis_device_commands")
        .select("id,action,payload,authorization_level,status,created_at,result")
        .eq("device_id", deviceId)
        .eq("kind", kind)
        .in("status", ["PENDING", "CLAIMED"])
        .order("created_at", { ascending: true })
        .limit(5);
      if (!error && data) {
        for (const row of data as CommandRow[]) {
          if (row.status === "PENDING" && now - Date.parse(row.created_at) > COMMAND_EXPIRY_MS) {
            await ctx.db.from("jarvis_device_commands").update({ status: "EXPIRED", completed_at: new Date().toISOString() }).eq("id", row.id).eq("status", "PENDING");
            continue;
          }
          if (row.status === "PENDING") {
            await ctx.db.from("jarvis_device_commands").update({ status: "CLAIMED", claimed_at: new Date().toISOString() }).eq("id", row.id).eq("status", "PENDING");
          }
          return rowToCommand(kind, row);
        }
        return null;
      }
    } catch {
      // Fall through to the cache queue.
    }
  }
  const queue = (await cacheGet<QueuedCommand[]>(queueKey(deviceId, kind))) ?? [];
  const fresh = queue.filter((command) => now - Date.parse(command.createdAt) <= COMMAND_EXPIRY_MS);
  if (fresh.length !== queue.length) await cacheSet(queueKey(deviceId, kind), fresh, 60 * 60);
  return fresh[0] ?? null;
}

async function completeCommand(deviceId: string, kind: CommandKind, result: CommandResult) {
  const results = (await cacheGet<CommandResult[]>(resultsKey(deviceId, kind))) ?? [];
  await cacheSet(resultsKey(deviceId, kind), [result, ...results.filter((item) => item.id !== result.id)].slice(0, MAX_RESULTS), 60 * 60 * 24);

  const queue = (await cacheGet<QueuedCommand[]>(queueKey(deviceId, kind))) ?? [];
  if (queue.some((command) => command.id === result.id)) {
    await cacheSet(queueKey(deviceId, kind), queue.filter((command) => command.id !== result.id), 60 * 60);
  }

  const ctx = await durableContext();
  if (ctx) {
    try {
      await ctx.db.from("jarvis_device_commands")
        .update({ status: result.ok ? "DONE" : "FAILED", completed_at: result.completedAt, result })
        .eq("id", result.id)
        .eq("device_id", deviceId);
    } catch {
      // Result is still cached for the UI.
    }
  }
}

async function findResult(deviceId: string, kind: CommandKind, id: string): Promise<{ result: CommandResult | null; pending: boolean }> {
  const results = (await cacheGet<CommandResult[]>(resultsKey(deviceId, kind))) ?? [];
  const cached = results.find((item) => item.id === id);
  if (cached) return { result: cached, pending: false };
  const ctx = await durableContext();
  if (ctx) {
    try {
      const { data } = await ctx.db.from("jarvis_device_commands").select("status,result").eq("id", id).eq("device_id", deviceId).maybeSingle();
      if (data) {
        const row = data as { status: string; result: CommandResult | null };
        if (row.status === "EXPIRED") {
          return { result: null, pending: false };
        }
        return { result: row.result ?? null, pending: row.status === "PENDING" || row.status === "CLAIMED" };
      }
    } catch {
      // fall through
    }
  }
  const queue = (await cacheGet<QueuedCommand[]>(queueKey(deviceId, kind))) ?? [];
  return { result: null, pending: queue.some((command) => command.id === id) };
}

async function latestResult(deviceId: string, kind: CommandKind) {
  const results = (await cacheGet<CommandResult[]>(resultsKey(deviceId, kind))) ?? [];
  return results[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* Agent-facing                                                        */
/* ------------------------------------------------------------------ */

export async function pollObserverControl(
  deviceId: string,
  deviceToken: string,
  observerVersion?: string | null,
  agentCapabilities?: string[] | null,
) {
  const link = await authenticateObserverDevice(deviceId, deviceToken);
  if (!link) return null;
  const next: ObserverDeviceLink = {
    ...link,
    lastHeartbeatAt: new Date().toISOString(),
    observerVersion: observerVersion ? String(observerVersion).slice(0, 30) : link.observerVersion,
    agentCapabilities: Array.isArray(agentCapabilities)
      ? agentCapabilities.map(item => String(item).trim().toUpperCase()).filter(Boolean).slice(0, 20)
      : link.agentCapabilities ?? [],
  };
  const [obsidianCommand, desktopCommand] = await Promise.all([
    nextCommand(deviceId, "OBSIDIAN"),
    nextCommand(deviceId, "DESKTOP"),
    saveLink(next, "throttled"),
    cacheSet(LOCAL_AGENT_PRESENCE_KEY, {
      deviceId: next.deviceId,
      deviceName: next.deviceName,
      lastHeartbeatAt: next.lastHeartbeatAt,
      lastFrameAt: next.lastFrameAt,
      observerVersion: next.observerVersion,
      agentCapabilities: next.agentCapabilities ?? [],
    }, 60 * 60 * 24, ["jarvis-local-agent"]),
  ]);
  return {
    ...safeLink(next),
    obsidianCommand: (obsidianCommand as LocalAgentObsidianCommand | null) ?? null,
    desktopCommand: (desktopCommand as LocalAgentDesktopCommand | null) ?? null,
  };
}

export async function markObserverFrame(deviceId: string, deviceToken: string, observerVersion?: string | null) {
  const link = await authenticateObserverDevice(deviceId, deviceToken);
  if (!link) return null;
  const now = new Date().toISOString();
  const next: ObserverDeviceLink = {
    ...link,
    lastHeartbeatAt: now,
    lastFrameAt: now,
    observerVersion: observerVersion ? String(observerVersion).slice(0, 30) : link.observerVersion,
  };
  await saveLink(next, "throttled");
  return safeLink(next);
}

export async function submitObsidianCommandResult(deviceId: string, deviceToken: string, result: LocalAgentObsidianResult) {
  const link = await authenticateObserverDevice(deviceId, deviceToken);
  if (!link) return null;
  if (!result?.id || !result?.action) return null;
  const normalized: LocalAgentObsidianResult = {
    id: String(result.id).slice(0, 80),
    action: result.action,
    ok: Boolean(result.ok),
    path: result.path == null ? null : String(result.path).slice(0, 500),
    data: result.data == null ? null : String(result.data).slice(0, 1_500_000),
    error: result.error == null ? null : String(result.error).slice(0, 2_000),
    completedAt: validDate(result.completedAt),
  };
  await completeCommand(deviceId, "OBSIDIAN", normalized);
  await saveLink({ ...link, lastHeartbeatAt: new Date().toISOString() }, "never");
  return normalized;
}

export async function submitDesktopCommandResult(deviceId: string, deviceToken: string, result: LocalAgentDesktopResult) {
  const link = await authenticateObserverDevice(deviceId, deviceToken);
  if (!link) return null;
  if (!result?.id || !result?.action) return null;
  const normalized: LocalAgentDesktopResult = {
    id: String(result.id).slice(0, 80),
    action: result.action,
    ok: Boolean(result.ok),
    summary: String(result.summary ?? "").slice(0, 2_000),
    data: result.data == null ? null : String(result.data).slice(0, 200_000),
    evidence: Array.isArray(result.evidence) ? result.evidence.map(item => String(item).slice(0, 2_000)).slice(0, 20) : [],
    error: result.error == null ? null : String(result.error).slice(0, 4_000),
    completedAt: validDate(result.completedAt),
  };
  await completeCommand(deviceId, "DESKTOP", normalized);
  await saveLink({ ...link, lastHeartbeatAt: new Date().toISOString() }, "never");
  return normalized;
}

/* ------------------------------------------------------------------ */
/* Controller-facing                                                   */
/* ------------------------------------------------------------------ */

export async function setObserverCommand(controllerToken: string, command: ObserverCommand) {
  const link = await resolveController(controllerToken);
  if (!link) return null;
  const next: ObserverDeviceLink = { ...link, command };
  await saveLink(next, "always");
  return safeLink(next);
}

export async function enqueueObsidianCommand(
  controllerToken: string,
  input: { action: LocalAgentObsidianAction; path?: string | null; content?: string | null; query?: string | null },
) {
  const link = await resolveController(controllerToken);
  if (!link) return null;

  const action = input.action;
  if (!["LIST", "READ", "WRITE", "SEARCH"].includes(action)) return null;

  const path = String(input.path ?? "").replace(/\\/g, "/").replace(/^\/+/, "").slice(0, 500) || null;
  const content = input.content == null ? null : String(input.content).slice(0, 150_000);
  const query = input.query == null ? null : String(input.query).trim().slice(0, 500);
  if (action === "WRITE" && !path) return null;
  if (action === "WRITE" && !path!.toLowerCase().endsWith(".md")) return null;
  if (action === "READ" && !path) return null;
  if (action === "SEARCH" && !query) return null;
  if (path?.split("/").some(part => part === ".obsidian" || part === "..")) return null;

  const command: LocalAgentObsidianCommand = {
    id: `obs_${token(12)}`,
    action,
    path,
    content,
    query,
    createdAt: new Date().toISOString(),
  };
  await enqueue(link, "OBSIDIAN", command);
  return command;
}

export async function getObsidianCommandResult(controllerToken: string, commandId?: string | null) {
  const link = await resolveController(controllerToken);
  if (!link) return null;
  if (commandId) return findResult(link.deviceId, "OBSIDIAN", commandId);
  return { pending: false, result: await latestResult(link.deviceId, "OBSIDIAN") };
}

const READ_ONLY_DESKTOP_ACTIONS = new Set<LocalAgentDesktopAction>(["GET_CONTEXT", "SCREEN_CAPTURE", "CLIPBOARD_READ", "BROWSER_READ_PAGE"]);
const USER_AUTHORIZED_DESKTOP_ACTIONS = new Set<LocalAgentDesktopAction>([
  "OPEN_APP",
  "FOCUS_WINDOW",
  "OPEN_PATH",
  "OPEN_URI",
  "CLIPBOARD_WRITE",
  "UI_CLICK_TEXT",
  "UI_TYPE_TEXT",
  "BROWSER_NAVIGATE",
  "BROWSER_SEARCH",
  "BROWSER_BACK",
  "RUN_CODING_AGENT",
  "RUN_APPROVED_COMMAND",
]);

export function desktopActionRequiresApproval(action: LocalAgentDesktopAction) {
  return USER_AUTHORIZED_DESKTOP_ACTIONS.has(action);
}

export async function enqueueDesktopCommand(
  controllerToken: string,
  input: {
    action: LocalAgentDesktopAction;
    target?: string | null;
    text?: string | null;
    args?: string[] | null;
    authorization?: "READ_ONLY" | "USER_AUTHORIZED";
  },
) {
  const link = await resolveController(controllerToken);
  if (!link) return null;

  const action = input.action;
  if (!READ_ONLY_DESKTOP_ACTIONS.has(action) && !USER_AUTHORIZED_DESKTOP_ACTIONS.has(action)) return null;

  const authorization = input.authorization === "USER_AUTHORIZED" ? "USER_AUTHORIZED" : "READ_ONLY";
  if (USER_AUTHORIZED_DESKTOP_ACTIONS.has(action) && authorization !== "USER_AUTHORIZED") return null;

  const target = input.target == null ? null : String(input.target).trim().slice(0, 1000);
  const text = input.text == null ? null : String(input.text).slice(0, 20_000);
  const args = Array.isArray(input.args) ? input.args.map(item => String(item).slice(0, 1000)).slice(0, 20) : [];

  if (["OPEN_APP", "FOCUS_WINDOW", "OPEN_PATH", "OPEN_URI", "UI_CLICK_TEXT", "BROWSER_NAVIGATE", "BROWSER_SEARCH", "RUN_CODING_AGENT", "RUN_APPROVED_COMMAND"].includes(action) && !target) {
    return null;
  }
  if (["CLIPBOARD_WRITE", "UI_TYPE_TEXT"].includes(action) && text == null) return null;

  const command: LocalAgentDesktopCommand = {
    id: `desk_${token(12)}`,
    action,
    target,
    text,
    args,
    createdAt: new Date().toISOString(),
    authorization,
  };
  await enqueue(link, "DESKTOP", command);
  return command;
}

/**
 * Server-side enqueue to the currently present Local Agent, used only for work
 * Dwight already approved (the caller must have recorded that approval).
 */
export async function enqueueApprovedDesktopCommandForPresentDevice(input: {
  action: LocalAgentDesktopAction;
  target: string;
  text: string;
  args?: string[];
}) {
  const presence = await cacheGet<{ deviceId?: string }>(LOCAL_AGENT_PRESENCE_KEY);
  if (!presence?.deviceId) return null;
  const link = await loadLink(presence.deviceId);
  if (!link) return null;
  const command: LocalAgentDesktopCommand = {
    id: `desk_${token(12)}`,
    action: input.action,
    target: input.target.slice(0, 1000),
    text: input.text.slice(0, 20_000),
    args: (input.args ?? []).map((item) => String(item).slice(0, 1000)).slice(0, 20),
    createdAt: new Date().toISOString(),
    authorization: "USER_AUTHORIZED",
  };
  await enqueue(link, "DESKTOP", command);
  return command;
}

export async function getDesktopCommandResult(controllerToken: string, commandId?: string | null) {
  const link = await resolveController(controllerToken);
  if (!link) return null;
  if (commandId) {
    const found = await findResult(link.deviceId, "DESKTOP", commandId);
    return { ...found, link: safeLink(link) };
  }
  return { pending: false, result: await latestResult(link.deviceId, "DESKTOP"), link: safeLink(link) };
}

export async function getLocalAgentPresence() {
  const presence = await cacheGet<{
    deviceId?: string;
    deviceName?: string;
    lastHeartbeatAt?: string | null;
    lastFrameAt?: string | null;
    observerVersion?: string | null;
    agentCapabilities?: string[];
  }>(LOCAL_AGENT_PRESENCE_KEY);
  if (!presence) return null;
  const heartbeatAge = presence.lastHeartbeatAt ? Date.now() - Date.parse(presence.lastHeartbeatAt) : Number.POSITIVE_INFINITY;
  const capabilities = new Set((presence.agentCapabilities ?? []).map(item => item.toUpperCase()));
  return {
    ...presence,
    online: heartbeatAge < 15_000,
    desktopRuntime: versionAtLeast(presence.observerVersion, 0, 8, 0),
    browserRuntime: versionAtLeast(presence.observerVersion, 0, 9, 0) && capabilities.has("BROWSER"),
    codingRuntime: versionAtLeast(presence.observerVersion, 0, 9, 0),
    codexCli: capabilities.has("CODEX"),
    claudeCli: capabilities.has("CLAUDE"),
  };
}

export async function getObserverLinkStatus(controllerToken: string) {
  const link = await resolveController(controllerToken);
  return link ? safeLink(link) : null;
}

function versionAtLeast(value: string | null | undefined, major: number, minor: number, patch: number) {
  const parts = String(value ?? "").split(".").map(part => Number.parseInt(part, 10));
  if (parts.some(Number.isNaN)) return false;
  const current = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  const required = [major, minor, patch];
  for (let index = 0; index < required.length; index += 1) {
    if (current[index] > required[index]) return true;
    if (current[index] < required[index]) return false;
  }
  return true;
}

function validDate(value: string | null | undefined) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : new Date().toISOString();
}

function safeLink(link: ObserverDeviceLink) {
  const heartbeatAge = link.lastHeartbeatAt ? Date.now() - Date.parse(link.lastHeartbeatAt) : Number.POSITIVE_INFINITY;
  return {
    deviceId: link.deviceId,
    deviceName: link.deviceName,
    pairedAt: link.pairedAt,
    lastHeartbeatAt: link.lastHeartbeatAt,
    lastFrameAt: link.lastFrameAt,
    command: link.command,
    observerVersion: link.observerVersion,
    agentCapabilities: link.agentCapabilities ?? [],
    online: heartbeatAge < 15_000,
  };
}
