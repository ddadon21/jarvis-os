import { getObserverLinkStatus } from "../../../../../lib/trading-device-link";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return Response.json({ ok: false, paired: false }, { status: 401 });
  const link = await getObserverLinkStatus(token);
  if (!link) return Response.json({ ok: false, paired: false }, { status: 401 });
  return Response.json({ ok: true, paired: true, link });
}
