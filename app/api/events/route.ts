import { appendRuntimeEvent, createRuntimeEvent, getRecentEvents, RuntimeDomain } from "../../../lib/jarvis-runtime";

export const runtime = "nodejs";

type IncomingEvent = {
  type?: string;
  domain?: RuntimeDomain;
  source?: string;
  importance?: "BACKGROUND" | "NORMAL" | "IMPORTANT" | "TIME_SENSITIVE" | "CRITICAL";
  occurredAt?: string;
  summary?: string;
  secret?: string;
};

export async function GET() {
  const events = await getRecentEvents();
  return Response.json({ events: events.slice(0, 25) });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as IncomingEvent;
  const configuredSecret = process.env.JARVIS_EVENT_SECRET;
  const authorization = request.headers.get("authorization");
  const url = new URL(request.url);

  const previewManual = process.env.VERCEL_ENV !== "production" && url.searchParams.get("manual") === "1";
  const authorized = configuredSecret
    ? authorization === `Bearer ${configuredSecret}` || body.secret === configuredSecret
    : previewManual;

  if (!authorized) {
    return Response.json(
      {
        ok: false,
        error: configuredSecret
          ? "Unauthorized"
          : "External event intake is locked until JARVIS_EVENT_SECRET is configured.",
      },
      { status: configuredSecret ? 401 : 503 },
    );
  }

  const type = typeof body.type === "string" ? body.type.trim() : "";
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";

  if (!type || !summary) {
    return Response.json({ ok: false, error: "type and summary are required" }, { status: 400 });
  }

  const event = createRuntimeEvent({
    type,
    domain: body.domain,
    source: body.source,
    importance: body.importance,
    occurredAt: body.occurredAt,
    summary,
  });

  await appendRuntimeEvent(event);
  return Response.json({ ok: true, event });
}
