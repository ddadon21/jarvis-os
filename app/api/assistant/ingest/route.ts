import { setAssistantRuntimeState, type JarvisAssistantRuntime } from "../../../../lib/jarvis-assistant-runtime";

export const runtime = "nodejs";

function bearer(request: Request) {
  const value = request.headers.get("authorization") ?? "";
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : "";
}

export async function POST(request: Request) {
  const expected = process.env.JARVIS_ASSISTANT_INGEST_TOKEN;
  if (!expected) {
    return Response.json(
      { ok: false, error: "Assistant ingest is not configured on this deployment." },
      { status: 503 },
    );
  }

  const provided = bearer(request);
  if (!provided || provided !== expected) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as Partial<JarvisAssistantRuntime> | null;
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "Invalid assistant runtime payload." }, { status: 400 });
  }

  const state = await setAssistantRuntimeState(body);
  return Response.json({
    ok: true,
    updatedAt: state.updatedAt,
    sources: state.sources,
    counts: {
      calendarEvents: state.calendar.events.length,
      meetingPresence: state.meetingPresence.people.length,
      communications: state.communications.recent.length,
    },
  });
}
