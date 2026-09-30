import {
  submitDesktopCommandResult,
  type LocalAgentDesktopResult,
} from "../../../../lib/trading-device-link";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const deviceId = request.headers.get("x-jarvis-device-id");
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!deviceId || !token) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null) as LocalAgentDesktopResult | null;
  if (!body?.id || !body?.action) {
    return Response.json({ ok: false, error: "Invalid desktop result." }, { status: 400 });
  }

  const result = await submitDesktopCommandResult(deviceId, token, body);
  if (!result) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  return Response.json({ ok: true, result }, {
    headers: { "Cache-Control": "no-store" },
  });
}
