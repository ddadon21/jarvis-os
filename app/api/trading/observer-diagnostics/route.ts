import { authenticateObserverDevice } from "../../../../lib/trading-device-link";
import { normalizeObserverDiagnostics, saveObserverDiagnostics } from "../../../../lib/observer-diagnostics";

export const runtime = "nodejs";

/**
 * Daily Observer reliability snapshot from the Local Agent (Observer >= 1.1).
 * Device-authenticated like the journal sync; owners read it via /api/trading/state.
 */
export async function POST(request: Request) {
  const deviceId = request.headers.get("x-jarvis-device-id");
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const device = await authenticateObserverDevice(deviceId, token);
  if (!device) return Response.json({ ok: false, error: "Observer device is not paired." }, { status: 401 });

  const text = await request.text();
  if (text.length > 64_000) return Response.json({ ok: false, error: "Diagnostics snapshot too large." }, { status: 413 });
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { body = null; }
  const diagnostics = normalizeObserverDiagnostics(body, device.deviceId);
  if (!diagnostics) return Response.json({ ok: false, error: "Invalid diagnostics snapshot." }, { status: 400 });

  const stored = await saveObserverDiagnostics(diagnostics);
  // 503 lets the Observer retry later instead of treating the upload as done.
  if (!stored) return Response.json({ ok: false, error: "Durable storage unavailable." }, { status: 503 });
  return Response.json({ ok: true, day: diagnostics.day });
}
