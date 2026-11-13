import { getCache } from "@vercel/functions";
import { durableContext } from "./jarvis-db";

const KEY = "jarvis:obsidian:direct-vault-health:v1";
const STATE_KEY = "runtime.obsidian-direct-vault-health.v1";
const MAX_AGE_MS = 15 * 60_000;

export type VaultBridgeHealth = {
  deviceId: string;
  checkedAt: string;
  ok: boolean;
  pullOk: boolean;
  indexOk: boolean;
  mode: "DIRECT_VAULT";
};

function validHealth(input: unknown): input is VaultBridgeHealth {
  if (!input || typeof input !== "object") return false;
  const x = input as Partial<VaultBridgeHealth>;
  return typeof x.deviceId === "string" &&
    x.mode === "DIRECT_VAULT" &&
    typeof x.checkedAt === "string" &&
    Number.isFinite(Date.parse(x.checkedAt)) &&
    typeof x.ok === "boolean" &&
    typeof x.pullOk === "boolean" &&
    typeof x.indexOk === "boolean";
}

export function healthyVaultForDevice(health: VaultBridgeHealth | null, deviceId: string | undefined, now = Date.now()) {
  return Boolean(health && deviceId &&
    health.deviceId === deviceId && health.ok &&
    now - Date.parse(health.checkedAt) >= 0 &&
    now - Date.parse(health.checkedAt) < MAX_AGE_MS);
}

export async function readVaultBridgeHealth(): Promise<VaultBridgeHealth | null> {
  try {
    const cached = await getCache().get(KEY);
    if (validHealth(cached)) return cached;
  } catch { /* fall back to the database */ }
  const ctx = await durableContext();
  if (!ctx) return null;
  const { data, error } = await ctx.db.from("jarvis_state_snapshots")
    .select("payload")
    .eq("workspace_id", ctx.workspaceId)
    .eq("state_key", STATE_KEY)
    .maybeSingle();
  if (error) return null;
  const value = (data?.payload as { health?: unknown } | null)?.health;
  return validHealth(value) ? value : null;
}

export async function saveVaultBridgeHealth(health: VaultBridgeHealth): Promise<boolean> {
  if (!validHealth(health)) return false;
  const ctx = await durableContext();
  if (!ctx) return false;
  const { error } = await ctx.db.from("jarvis_state_snapshots").upsert({
    workspace_id: ctx.workspaceId,
    state_key: STATE_KEY,
    version: 1,
    payload: { format: "obsidian-direct-health-v1", health },
    source: "JARVIS LOCAL AGENT",
    client_updated_at: health.checkedAt,
  }, { onConflict: "workspace_id,state_key" });
  if (error) return false;
  try { await getCache().set(KEY, health, { ttl: 3600 }); } catch { /* durable record is authoritative */ }
  return true;
}
