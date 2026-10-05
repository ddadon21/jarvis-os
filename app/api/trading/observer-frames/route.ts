import { authenticateObserverDevice } from "../../../../lib/trading-device-link";
import { durableContext } from "../../../../lib/jarvis-db";

export const runtime = "nodejs";

const BUCKET = "jarvis-attachments";
const MAX_BYTES = 3_000_000;

/** Stores one key frame of a journaled trade (Observer uploads ~1 per event + 1 per minute). */
export async function POST(request: Request) {
  const deviceId = request.headers.get("x-jarvis-device-id");
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const device = await authenticateObserverDevice(deviceId, token);
  if (!device) return Response.json({ ok: false, error: "Observer device is not paired." }, { status: 401 });

  const body = await request.json().catch(() => null) as { tradeId?: string; capturedAt?: string; imageBase64?: string } | null;
  const tradeId = typeof body?.tradeId === "string" ? body.tradeId.slice(0, 200) : "";
  const capturedAt = body?.capturedAt && Number.isFinite(Date.parse(body.capturedAt)) ? new Date(body.capturedAt).toISOString() : null;
  if (!tradeId || !capturedAt || typeof body?.imageBase64 !== "string") {
    return Response.json({ ok: false, error: "tradeId, capturedAt and imageBase64 are required." }, { status: 400 });
  }
  const bytes = Buffer.from(body.imageBase64, "base64");
  if (!bytes.length || bytes.length > MAX_BYTES) return Response.json({ ok: false, error: "Invalid frame size." }, { status: 400 });

  const ctx = await durableContext();
  if (!ctx) return Response.json({ ok: false, error: "Durable storage is not configured on the server." }, { status: 503 });

  const safeTrade = tradeId.replace(/[^A-Za-z0-9_-]/g, "_");
  const objectPath = `${ctx.workspaceId}/trade-frames/${safeTrade}/${capturedAt.replace(/[^0-9TZ]/g, "")}.jpg`;
  const { error: uploadError } = await ctx.db.storage.from(BUCKET).upload(objectPath, bytes, { contentType: "image/jpeg", upsert: true });
  if (uploadError) return Response.json({ ok: false, error: "Upload failed: " + uploadError.message }, { status: 502 });

  const { error } = await ctx.db.from("trading_trade_frames").upsert({
    workspace_id: ctx.workspaceId,
    trade_id: tradeId,
    captured_at: capturedAt,
    object_path: objectPath,
  }, { onConflict: "workspace_id,trade_id,captured_at" });
  if (error) return Response.json({ ok: false, error: "Frame index failed: " + error.message }, { status: 502 });
  return Response.json({ ok: true, objectPath });
}
