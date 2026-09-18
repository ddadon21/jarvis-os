import { setObserverCommand, type ObserverCommand } from "../../../../lib/trading-device-link";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const body = await request.json().catch(() => null) as { command?: ObserverCommand } | null;
  if (!token) return Response.json({ ok: false, error: "Controller token required." }, { status: 401 });
  if (body?.command !== "WATCH" && body?.command !== "PAUSE") {
    return Response.json({ ok: false, error: "Command must be WATCH or PAUSE." }, { status: 400 });
  }
  const link = await setObserverCommand(token, body.command);
  if (!link) return Response.json({ ok: false, error: "Observer link not found." }, { status: 401 });
  return Response.json({ ok: true, link });
}
