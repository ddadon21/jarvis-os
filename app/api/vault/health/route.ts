import { authenticateObserverDevice } from "../../../../lib/trading-device-link";
import { saveVaultBridgeHealth } from "../../../../lib/obsidian-vault-health";

export const runtime = "nodejs";

/** Evidence-based vault health: only the authenticated Windows Local Agent may report it. */
export async function POST(request: Request) {
  const deviceId = request.headers.get("x-jarvis-device-id");
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const device = await authenticateObserverDevice(deviceId, token);
  if (!device) return Response.json({ ok: false, error: "Local Agent is not paired." }, { status: 401 });

  const input = await request.json().catch(() => null) as { pullOk?: unknown; indexOk?: unknown } | null;
  if (typeof input?.pullOk !== "boolean" || typeof input?.indexOk !== "boolean")
    return Response.json({ ok: false, error: "Invalid health report." }, { status: 400 });

  const record = {
    deviceId: device.deviceId,
    checkedAt: new Date().toISOString(),
    pullOk: input.pullOk,
    indexOk: input.indexOk,
    ok: input.pullOk && input.indexOk,
    mode: "DIRECT_VAULT" as const,
  };
  const saved = await saveVaultBridgeHealth(record);
  if (!saved) return Response.json({ ok: false, error: "Could not persist vault health." }, { status: 503 });
  return Response.json({ ok: true, health: record }, { headers: { "Cache-Control": "no-store" } });
}
