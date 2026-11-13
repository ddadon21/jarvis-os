"server-only";

import { getAssistantRuntimeState } from "./jarvis-assistant-runtime";
import { getGoogleWorkspaceStatus } from "./google-workspace";
import { getLocalAgentPresence } from "./trading-device-link";
import { healthyVaultForDevice, readVaultBridgeHealth } from "./obsidian-vault-health";
import { durableContext } from "./jarvis-db";

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
  const [assistant, google, localAgent, vaultHealth, supabaseContext] = await Promise.all([
    getAssistantRuntimeState(),
    getGoogleWorkspaceStatus(),
    getLocalAgentPresence(),
    readVaultBridgeHealth(),
    durableContext(),
  ]);
  const agentOnline = Boolean(localAgent?.online);
  const vaultOnline = agentOnline && healthyVaultForDevice(vaultHealth, localAgent?.deviceId);

  const googleFeedsReady =
    assistant.sources.calendar === "CONNECTED" &&
    assistant.sources.email === "CONNECTED";
  const googleConnected = google.connected && googleFeedsReady;
  const googleReady = google.configured;

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
  const supabaseServerConfigured = Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
  const productionRuntime = process.env.VERCEL_ENV === "production";

  return [
    {
      id: "GOOGLE_WORKSPACE",
      label: "Google Workspace",
      state: googleConnected
        ? "CONNECTED"
        : google.connected
          ? "DEGRADED"
          : googleReady
            ? "READY_TO_AUTHORIZE"
            : "NEEDS_APP_SETUP",
      capabilities: ["Google Calendar read/write", "Gmail read", "Gmail drafts", "Gmail send with approval"],
      note: googleConnected
        ? `Google Calendar and Gmail are synchronized for ${google.email ?? "the authorized account"}.`
        : google.connected
          ? "Google OAuth is authorized, but the assistant feed has not completed a healthy Calendar + Gmail sync yet."
          : googleReady
            ? "Google OAuth credentials are configured. Dwight must authorize Calendar and Gmail once."
            : "Create a Google OAuth web app and add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to connect Calendar and Gmail.",
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
      state: vaultOnline ? "CONNECTED" : agentOnline ? "DEGRADED" : "NEEDS_CONNECTION",
      capabilities: ["Long-term notes", "Knowledge map", "Decision history"],
      note: vaultOnline
        ? "Direct vault pull and index confirmed by the paired Windows Local Agent."
        : agentOnline
          ? "Local Agent is online, but a recent successful vault sync has not been verified. Choose the vault folder and run a write test."
          : "No live Windows Local Agent heartbeat. Pair the device before connecting the Obsidian vault.",
    },
    {
      id: "TRADING_OBSERVER",
      label: "Trading Observer",
      state: agentOnline ? "CONNECTED" : localAgent ? "DEGRADED" : "NEEDS_CONNECTION",
      capabilities: ["Screen observations", "Trading state", "Journal context"],
      note: agentOnline
        ? "Windows Local Agent heartbeat is current. TradingView detection and journal completeness require their own tests."
        : "No current Observer heartbeat. A local TradingView notification alone does not confirm cloud pairing.",
    },
    {
      id: "SUPABASE",
      label: "Supabase",
      state: supabaseContext
        ? "CONNECTED"
        : supabaseServerConfigured || productionRuntime
          ? "DEGRADED"
          : "NEEDS_CONNECTION",
      capabilities: ["Structured memory", "Runtime persistence", "History"],
      note: supabaseContext
        ? "Primary Supabase workspace was successfully read by the server."
        : supabaseServerConfigured
          ? "A server key is configured but the primary workspace could not be verified."
          : "A server-side Supabase key is required for durable state; temporary cache does not prove persistence.",
    },
  ];
}
