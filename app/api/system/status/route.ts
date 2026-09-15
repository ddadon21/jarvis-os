import { getLatestPulse, getRecentEvents } from "../../../../lib/jarvis-runtime";

export const runtime = "nodejs";

export async function GET() {
  const [pulse, events] = await Promise.all([getLatestPulse(), getRecentEvents()]);
  const researchState = pulse?.status === "ERROR" ? "DEGRADED" : pulse ? "ACTIVE" : "STARTING";

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
      sentryopsResearch: researchState,
      life: "ACTIVE",
    },
    providerCapabilities: {
      vercelGatewayCredentialPresent: Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN),
      anthropicDirectCredentialPresent: Boolean(process.env.ANTHROPIC_API_KEY),
      openaiDirectCredentialPresent: Boolean(process.env.OPENAI_API_KEY),
      secureDatabaseConfigured: Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
          process.env.SUPABASE_SERVICE_ROLE_KEY,
      ),
    },
    note: "Sensitive financial and trading state will move to the secure database layer when those integrations are connected.",
  });
}
