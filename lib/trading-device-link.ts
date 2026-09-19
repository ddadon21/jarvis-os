import { createHash, randomBytes } from "node:crypto";
import { getCache } from "@vercel/functions";

export type ObserverCommand = "WATCH" | "PAUSE";

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
  };

  await Promise.all([
    getCache().set(deviceKey(link.deviceId), link, { ttl: DEVICE_TTL_SECONDS, tags: ["jarvis-trading-device"] }),
    getCache().set(controllerKey(controllerTokenHash), { deviceId: link.deviceId }, { ttl: DEVICE_TTL_SECONDS, tags: ["jarvis-trading-device"] }),
    // Consume the one-time code so a duplicate confirm cannot mint another
    // controller token and silently invalidate the browser that already paired.
    getCache().set(pairKey(normalized), { ...pending, expiresAt: new Date(0).toISOString() }, { ttl: 1, tags: ["jarvis-trading-pairing"] }),
  ]);

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
  return safeLink(next);
}

export async function setObserverCommand(controllerToken: string, command: ObserverCommand) {
  const link = await resolveController(controllerToken);
  if (!link) return null;
  const next: ObserverDeviceLink = { ...link, command };
  await getCache().set(deviceKey(link.deviceId), next, { ttl: DEVICE_TTL_SECONDS, tags: ["jarvis-trading-device"] });
  return safeLink(next);
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
