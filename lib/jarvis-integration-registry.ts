"server-only";

import { getAssistantRuntimeState } from "./jarvis-assistant-runtime";

export type JarvisIntegrationId =
  | "GOOGLE_WORKSPACE"
  | "MICROSOFT_365"
  | "ZOOM"
  | "DISCORD"
  | "ICLOUD_CALENDAR"
  | "LIVE_WEB"
  | "OBSIDIAN"
  | "TRADING_OBSERVER"
  | "SUPABASE";

export type JarvisIntegrationState =
  | "CONNECTED"
  | "READY_TO_AUTHORIZE"
  | "NEEDS_APP_SETUP"
  | "NEEDS_CONNECTION"
  | "DEGRADED";

export type JarvisIntegration = {
  id: JarvisIntegrationId;
  label: string;
  state: JarvisIntegrationState;
  capabilities: string[];
  note: string;
};

function has(...keys: string[]) {
  return keys.every((key) => Boolean(process.env[key]));
}

export async function getJarvisIntegrationRegistry(): Promise<JarvisIntegration[]> {
  const assistant = await getAssistantRuntimeState();

  const googleConnected =
    assistant.sources.calendar === "CONNECTED" &&
    assistant.sources.email === "CONNECTED" &&
    assistant.sources.contacts === "CONNECTED";
  const googleReady = has("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET");

  const microsoftConnected =
    assistant.sources.meetings === "CONNECTED" &&
    (assistant.sources.calendar === "CONNECTED" || assistant.sources.email === "CONNECTED");
  const microsoftReady =
    has("MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET") ||
    has("AZURE_AD_CLIENT_ID", "AZURE_AD_CLIENT_SECRET");

  const zoomReady = has("ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET");
  const discordReady =
    Boolean(process.env.DISCORD_BOT_TOKEN) ||
    has("DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET");
  const icloudReady =
    has("ICLOUD_CALDAV_USERNAME", "ICLOUD_APP_SPECIFIC_PASSWORD");
  const supabaseServerConfigured = has("SUPABASE_SERVICE_ROLE_KEY");
  const productionRuntime = process.env.VERCEL_ENV === "production";

  return [
    {
      id: "GOOGLE_WORKSPACE",
      label: "Google Workspace",
      state: googleConnected ? "CONNECTED" : googleReady ? "READY_TO_AUTHORIZE" : "NEEDS_APP_SETUP",
      capabilities: ["Google Calendar", "Gmail", "Google Contacts"],
      note: googleConnected
        ? "Calendar, mail, and contacts are available to the assistant runtime."
        : "One Google OAuth app can authorize Calendar, Gmail, and Contacts for JARVIS.",
    },
    {
      id: "MICROSOFT_365",
      label: "Microsoft 365",
      state: microsoftConnected ? "CONNECTED" : microsoftReady ? "READY_TO_AUTHORIZE" : "NEEDS_APP_SETUP",
      capabilities: ["Outlook Calendar", "Outlook Mail", "Microsoft Teams"],
      note: "Microsoft Graph is the shared integration layer for Outlook and Teams.",
    },
    {
      id: "ZOOM",
      label: "Zoom",
      state: assistant.sources.meetings === "CONNECTED" ? "CONNECTED" : zoomReady ? "READY_TO_AUTHORIZE" : "NEEDS_APP_SETUP",
      capabilities: ["Meetings", "Participants", "Waiting/join signals", "Recordings", "Webhooks"],
      note: "OAuth plus event subscriptions lets JARVIS react to meeting activity instead of polling blindly.",
    },
    {
      id: "DISCORD",
      label: "Discord",
      state: discordReady ? "READY_TO_AUTHORIZE" : "NEEDS_APP_SETUP",
      capabilities: ["Servers", "Channels", "Messages", "Mentions", "Presence where permitted"],
      note: "A Discord bot/app can feed messages and operational signals into JARVIS.",
    },
    {
      id: "ICLOUD_CALENDAR",
      label: "iCloud Calendar",
      state: icloudReady ? "READY_TO_AUTHORIZE" : "NEEDS_APP_SETUP",
      capabilities: ["iPhone/iCloud calendars", "Events"],
      note: "Direct iCloud Calendar support will use CalDAV with credentials kept server-side only.",
    },
    {
      id: "LIVE_WEB",
      label: "Live Web",
      state: assistant.sources.webSearch === "CONNECTED" ? "CONNECTED" : "NEEDS_CONNECTION",
      capabilities: ["Current public information", "News", "Changing facts"],
      note: "Used only for fresh public information that should not rely on stale model knowledge.",
    },
    {
      id: "OBSIDIAN",
      label: "Obsidian",
      state: "CONNECTED",
      capabilities: ["Long-term notes", "Knowledge map", "Decision history"],
      note: "Connected through the Windows Local Agent.",
    },
    {
      id: "TRADING_OBSERVER",
      label: "Trading Observer",
      state: "CONNECTED",
      capabilities: ["Screen observations", "Trading state", "Journal context"],
      note: "Observation and analysis only; no trade execution.",
    },
    {
      id: "SUPABASE",
      label: "Supabase",
      state: supabaseServerConfigured
        ? "CONNECTED"
        : productionRuntime
          ? "DEGRADED"
          : "NEEDS_CONNECTION",
      capabilities: ["Structured memory", "Runtime persistence", "History"],
      note: supabaseServerConfigured
        ? "Server-side Supabase mirror is active for durable workforce state."
        : productionRuntime
          ? "Production expects a server-side Supabase service role for the durable workforce mirror."
          : "Preview runtime is operating on Vercel Runtime Cache; the Supabase server mirror is intentionally treated as unattached instead of a failed service.",
    },
  ];
}
