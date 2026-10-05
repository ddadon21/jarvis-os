import { authenticateObserverDevice } from "../../../../lib/trading-device-link";
import { buildVaultNotes } from "../../../../lib/vault-notes";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Local Agent pulls JARVIS's notes and writes them into <vault>/JARVIS/ (inside markers only). */
export async function GET(request: Request) {
  const deviceId = request.headers.get("x-jarvis-device-id");
  const auth = request.headers.get("authorization") ?? "";
  const device = await authenticateObserverDevice(deviceId, auth.startsWith("Bearer ") ? auth.slice(7).trim() : "");
  if (!device) return Response.json({ ok: false, error: "Observer device is not paired." }, { status: 401 });
  return Response.json({ ok: true, notes: await buildVaultNotes() }, { headers: { "Cache-Control": "no-store" } });
}
