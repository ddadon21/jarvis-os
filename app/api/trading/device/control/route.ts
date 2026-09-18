import { pollObserverControl } from "../../../../../lib/trading-device-link";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const deviceId = request.headers.get("x-jarvis-device-id");
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const observerVersion = request.headers.get("x-jarvis-observer-version");
  const link = deviceId && token ? await pollObserverControl(deviceId, token, observerVersion) : null;
  if (!link) return Response.json({ ok: false, error: "Observer device is not paired." }, { status: 401 });
  return Response.json({ ok: true, link });
}
