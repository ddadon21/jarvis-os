import { getOrSeedFinanceState } from "../../../../lib/finance-live";
import { getOrSeedWorkforceState } from "../../../../lib/jarvis-workforce";
import { plaidFinanceConfigured } from "../../../../lib/plaid-finance";
import { getLatestPulse, getRecentEvents } from "../../../../lib/jarvis-runtime";
import { getTradingState } from "../../../../lib/trading-runtime";
import { getAssistantRuntimeState, getAssistantAlerts } from "../../../../lib/jarvis-assistant-runtime";

export const runtime = "nodejs";

export async function GET() {
  const [pulse, events, workforce, finance, trading, assistant] = await Promise.all([
    getLatestPulse(),
    getRecentEvents(),
    getOrSeedWorkforceState(),
    getOrSeedFinanceState(),
    getTradingState(),
    getAssistantRuntimeState(),
  ]);

  const researchState = pulse?.status === "ERROR" ? "DEGRADED" : pulse ? "ACTIVE" : "STARTING";
  const financeState = finance.mode === "DIRECT" ? "ACTIVE" : "SYNCED_SNAPSHOT";
  const tradingState = trading.account.connection === "OBSERVING" ? "ACTIVE" : trading.account.connection === "DEGRADED" ? "DEGRADED" : "PENDING";
  const degraded = workforce.status === "DEGRADED" || pulse?.status === "ERROR" || trading.account.connection === "DEGRADED";

  return Response.json({
    online: true,
    mode: degraded ? "DEGRADED" : "ACTIVE",
    workforce: {
      enabled: true,
      status: workforce.status,
      lastCycleAt: workforce.lastCycleAt,
      executiveSummary: workforce.executiveSummary,
      agents: workforce.agents,
      objectives: workforce.objectives.filter((objective) => objective.status === "ACTIVE").slice(0, 8),
    },
    backgroundResearch: {
      enabled: true,
      latestPulse: pulse,
    },
    finance: {
      mode: finance.mode,
      source: finance.source,
      asOf: finance.asOf,
      directProviderConfigured: plaidFinanceConfigured(),
      metrics: finance.metrics,
      goals: finance.goals,
    },
    events: events.slice(0, 16),
    trading: {
      connection: trading.account.connection,
      lastObservedAt: trading.account.lastObservedAt,
      observer: trading.observer ?? null,
      today: trading.today,
      stage: trading.account.stage,
    },
    integrations: {
      trading: tradingState,
      finance: financeState,
      sentryopsResearch: researchState,
      life: "ACTIVE",
      calendar: assistant.sources.calendar,
      email: assistant.sources.email,
      meetings: assistant.sources.meetings,
      contacts: assistant.sources.contacts,
      webSearch: assistant.sources.webSearch,
    },
    assistant: {
      updatedAt: assistant.updatedAt,
      sources: assistant.sources,
      alerts: getAssistantAlerts(assistant),
      upcomingEventCount: assistant.calendar.events.length,
      meetingPresenceCount: assistant.meetingPresence.people.length,
      recentCommunicationCount: assistant.communications.recent.length,
    },
    providerCapabilities: {
      vercelGatewayCredentialPresent: Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN),
      anthropicDirectCredentialPresent: Boolean(process.env.ANTHROPIC_API_KEY),
      openaiDirectCredentialPresent: Boolean(process.env.OPENAI_API_KEY),
      directFinanceProviderConfigured: plaidFinanceConfigured(),
      secureDatabaseConfigured: Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
          process.env.SUPABASE_SERVICE_ROLE_KEY,
      ),
    },
    note: finance.mode === "DIRECT"
      ? "Jarvis is operating from the direct finance state and the autonomous workforce runtime."
      : "Jarvis autonomous workforce is active. Finance is operating from the latest real synchronized snapshot until direct provider credentials are connected to the website.",
  });
}
