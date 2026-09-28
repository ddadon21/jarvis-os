import { getAssistantAlerts, getAssistantRuntimeState } from "../../../../lib/jarvis-assistant-runtime";

export const runtime = "nodejs";

export async function GET() {
  const state = await getAssistantRuntimeState();
  return Response.json({
    ok: true,
    updatedAt: state.updatedAt,
    sources: state.sources,
    alerts: getAssistantAlerts(state),
    counts: {
      upcomingEvents: state.calendar.events.length,
      meetingPresence: state.meetingPresence.people.length,
      recentCommunications: state.communications.recent.length,
    },
  });
}
