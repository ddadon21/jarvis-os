import { confirmObserverPairing } from "../../../../../lib/trading-device-link";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { code?: string } | null;
  if (!body?.code) return Response.json({ ok: false, error: "Pairing code required." }, { status: 400 });
  const pair = await confirmObserverPairing(body.code);
  if (!pair) return Response.json({ ok: false, error: "Pairing code is invalid or expired." }, { status: 404 });
  return Response.json({ ok: true, pair });
}
