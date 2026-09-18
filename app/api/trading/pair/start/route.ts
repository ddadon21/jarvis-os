import { startObserverPairing } from "../../../../../lib/trading-device-link";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { deviceName?: string };
  const pair = await startObserverPairing(body.deviceName ?? "Dwight Windows PC");
  return Response.json({ ok: true, pair });
}
