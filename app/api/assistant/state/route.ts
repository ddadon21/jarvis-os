import { getAssistantRuntimeState } from "../../../../lib/jarvis-assistant-runtime";

export const runtime = "nodejs";

export async function GET() {
  const state = await getAssistantRuntimeState();
  return Response.json({ ok: true, state }, {
    headers: { "Cache-Control": "no-store" },
  });
}
