import { createHash, randomBytes } from "node:crypto";
import { getCache } from "@vercel/functions";

export type ObserverCommand = "WATCH" | "PAUSE";

export type LocalAgentObsidianAction = "LIST" | "READ" | "WRITE";

export type LocalAgentObsidianCommand = {
  id: string;
  action: LocalAgentObsidianAction;
  path: string | null;
  content: string | null;
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
  obsidianCommand?: LocalAgentObsidianCommand | null;
  obsidianResult?: LocalAgentObsidianResult | null;
};

type PendingPair = {
  deviceId: string;
  deviceName: string;
  deviceTokenHash: string;
  createdAt: string;
  expiresAt: string;
};

const PAIR_TTL_SECONDS = 10 * 60;
const DEVICE_TTL_SECONDS = 60 * 60 * 24 * 90;

function pairKey(code: string) { return `jarvis:trading:pair:${normalizeCode(code)}`; }
function deviceKey(deviceId: string) { return `jarvis:trading:device:${deviceId}`; }
function controllerKey(hash: string) { return `jarvis:trading:controller:${hash}`; }

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
  const pending = await getCache().get(pairKey(normalized)) as PendingPair | null;
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
    obsidianCommand: null,
    obsidianResult: null,
  };

  await Promise.all([
    getCache().set(deviceKey(link.deviceId), link, { ttl: DEVICE_TTL_SECONDS, tags: ["jarvis-trading-device"] }),
    getCache().set(controllerKey(controllerTokenHash), { deviceId: link.deviceId }, { ttl: DEVICE_TTL_SECONDS, tags: ["jarvis-trading-device"] }),
  ]);

  // Pairing is already established at this point. Consume the one-time code
  // best-effort so a cleanup/cache hiccup can never turn a valid pair into a 500.
  try {
    await getCache().set(
      pairKey(normalized),
      { ...pending, expiresAt: new Date(0).toISOString() },
      { ttl: 1, tags: ["jarvis-trading-pairing"] },
    );
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
  const link = await getCache().get(deviceKey(deviceId)) as ObserverDeviceLink | null;
  if (!link || link.deviceTokenHash !== hash(deviceToken)) return null;
  return link;
}

async function resolveController(controllerToken: string | null) {
  if (!controllerToken) return null;
  const controllerTokenHash = hash(controllerToken);
  const mapping = await getCache().get(controllerKey(controllerTokenHash)) as { deviceId?: string } | null;
  if (!mapping?.deviceId) return null;
  const link = await getCache().get(deviceKey(mapping.deviceId)) as ObserverDeviceLink | null;
  if (!link || link.controllerTokenHash !== controllerTokenHash) return null;
  return link;
}

export async function pollObserverControl(deviceId: string, deviceToken: string, observerVersion?: string | null) {
  const link = await authenticateObserverDevice(deviceId, deviceToken);
  if (!link) return null;
  const next: ObserverDeviceLink = {
    ...link,
    lastHeartbeatAt: new Date().toISOString(),
    observerVersion: observerVersion ? String(observerVersion).slice(0, 30) : link.observerVersion,
  };
  await getCache().set(deviceKey(deviceId), next, { ttl: DEVICE_TTL_SECONDS, tags: ["jarvis-trading-device"] });
  return { ...safeLink(next), obsidianCommand: next.obsidianCommand ?? null };
}

export async function setObserverCommand(controllerToken: string, command: ObserverCommand) {
  const link = await resolveController(controllerToken);
  if (!link) return null;
  const next: ObserverDeviceLink = { ...link, command };
  await getCache().set(deviceKey(link.deviceId), next, { ttl: DEVICE_TTL_SECONDS, tags: ["jarvis-trading-device"] });
  return safeLink(next);
}

export async function enqueueObsidianCommand(
  controllerToken: string,
  input: { action: LocalAgentObsidianAction; path?: string | null; content?: string | null },
) {
  const link = await resolveController(controllerToken);
  if (!link) return null;

  const action = input.action;
  if (!["LIST", "READ", "WRITE"].includes(action)) return null;

  const path = String(input.path ?? "").replace(/\\/g, "/").replace(/^\/+/, "").slice(0, 500) || null;
  const content = input.content == null ? null : String(input.content).slice(0, 150_000);
  if (action === "WRITE" && !path) return null;
  if (action === "WRITE" && !path!.toLowerCase().endsWith(".md")) return null;
  if (path?.split("/").some(part => part === ".obsidian" || part === "..")) return null;

  const command: LocalAgentObsidianCommand = {
    id: `obs_${token(12)}`,
    action,
    path,
    content,
    createdAt: new Date().toISOString(),
  };

  const next: ObserverDeviceLink = {
    ...link,
    obsidianCommand: command,
  };
  await getCache().set(deviceKey(link.deviceId), next, { ttl: DEVICE_TTL_SECONDS, tags: ["jarvis-trading-device"] });
  return command;
}

export async function submitObsidianCommandResult(
  deviceId: string,
  deviceToken: string,
  result: LocalAgentObsidianResult,
) {
  const link = await authenticateObserverDevice(deviceId, deviceToken);
  if (!link) return null;
  if (!result?.id || !result?.action) return null;

  const normalized: LocalAgentObsidianResult = {
    id: String(result.id).slice(0, 80),
    action: result.action,
    ok: Boolean(result.ok),
    path: result.path == null ? null : String(result.path).slice(0, 500),
    data: result.data == null ? null : String(result.data).slice(0, 200_000),
    error: result.error == null ? null : String(result.error).slice(0, 2_000),
    completedAt: result.completedAt && Number.isFinite(Date.parse(result.completedAt))
      ? new Date(result.completedAt).toISOString()
      : new Date().toISOString(),
  };

  const matching = link.obsidianCommand?.id === normalized.id;
  const next: ObserverDeviceLink = {
    ...link,
    obsidianCommand: matching ? null : link.obsidianCommand ?? null,
    obsidianResult: normalized,
    lastHeartbeatAt: new Date().toISOString(),
  };
  await getCache().set(deviceKey(link.deviceId), next, { ttl: DEVICE_TTL_SECONDS, tags: ["jarvis-trading-device"] });
  return normalized;
}

export async function getObsidianCommandResult(controllerToken: string, commandId?: string | null) {
  const link = await resolveController(controllerToken);
  if (!link) return null;
  const result = link.obsidianResult ?? null;
  if (commandId && result?.id !== commandId) return { pending: Boolean(link.obsidianCommand?.id === commandId), result: null };
  return { pending: Boolean(link.obsidianCommand), result };
}

export async function getObserverLinkStatus(controllerToken: string) {
  const link = await resolveController(controllerToken);
  return link ? safeLink(link) : null;
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
  await getCache().set(deviceKey(deviceId), next, { ttl: DEVICE_TTL_SECONDS, tags: ["jarvis-trading-device"] });
  return safeLink(next);
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
    online: heartbeatAge < 15_000,
  };
}
