import { getLatestPulse, getRecentEvents } from "../../../../lib/jarvis-runtime";

export const runtime = "nodejs";

export async function GET() {
  const [pulse, events] = await Promise.all([getLatestPulse(), getRecentEvents()]);

  return Response.json({
    online: true,
    mode: pulse?.status === "ERROR" ? "DEGRADED" : "ACTIVE",
    backgroundResearch: {
      enabled: true,
      latestPulse: pulse,
    },
    events: events.slice(0, 12),
    integrations: {
      trading: "PENDING",
      finance: "PENDING",
      sentryopsResearch: pulse ? "ACTIVE" : "STARTING",
      life: "ACTIVE",
    },
    note: "Sensitive financial and trading state will move to the secure database layer when those integrations are connected.",
  });
}
