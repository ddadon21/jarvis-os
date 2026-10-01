"server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getCache } from "@vercel/functions";
import { createClient } from "@supabase/supabase-js";
import { getAssistantRuntimeState, setAssistantRuntimeState, type CalendarEventSnapshot, type CommunicationSignal } from "./jarvis-assistant-runtime";

const SUPABASE_FALLBACK_URL = "https://cubkgxdhkehmzczbvczy.supabase.co";
const TOKEN_STATE_KEY = "integration.google.oauth.v1";
const TOKEN_CACHE_KEY = "jarvis:integration:google:oauth:v1";
const TOKEN_TTL = 60 * 60 * 24 * 365;

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];

type GoogleTokenRecord = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string[];
  email: string | null;
  updatedAt: string;
};

type EncryptedRecord = {
  format: "aes-256-gcm-v1";
  iv: string;
  tag: string;
  ciphertext: string;
};

function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function serviceClient() {
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRole) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || SUPABASE_FALLBACK_URL;
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

function encryptionKey() {
  const secret = process.env.JARVIS_OAUTH_ENCRYPTION_KEY || process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) return null;
  return createHash("sha256").update(secret).digest();
}

function encrypt(record: GoogleTokenRecord): EncryptedRecord {
  const key = encryptionKey();
  if (!key) throw new Error("OAuth encryption key is unavailable.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(record), "utf8"), cipher.final()]);
  return {
    format: "aes-256-gcm-v1",
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

function decrypt(value: EncryptedRecord): GoogleTokenRecord | null {
  try {
    const key = encryptionKey();
    if (!key || value?.format !== "aes-256-gcm-v1") return null;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(value.iv, "base64url"));
    decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plain) as GoogleTokenRecord;
  } catch {
    return null;
  }
}

async function workspaceId() {
  const supabase = serviceClient();
  if (!supabase) return null;
  const { data } = await supabase.from("jarvis_workspaces").select("id").eq("slug", "primary").maybeSingle();
  return data?.id ?? null;
}

async function loadEncrypted(): Promise<EncryptedRecord | null> {
  try {
    const cached = await getCache().get(TOKEN_CACHE_KEY) as EncryptedRecord | null;
    if (cached?.format === "aes-256-gcm-v1") return cached;
  } catch {}

  const supabase = serviceClient();
  const id = await workspaceId();
  if (!supabase || !id) return null;
  try {
    const { data } = await supabase
      .from("jarvis_state_snapshots")
      .select("payload")
      .eq("workspace_id", id)
      .eq("state_key", TOKEN_STATE_KEY)
      .maybeSingle();
    const payload = data?.payload as { format?: string; data?: EncryptedRecord } | null;
    const encrypted = payload?.format === "encrypted-oauth-v1" ? payload.data ?? null : null;
    if (encrypted) {
      try { await getCache().set(TOKEN_CACHE_KEY, encrypted, { ttl: TOKEN_TTL, tags: ["jarvis-google"] }); } catch {}
    }
    return encrypted;
  } catch {
    return null;
  }
}

async function saveRecord(record: GoogleTokenRecord) {
  const encrypted = encrypt(record);
  try { await getCache().set(TOKEN_CACHE_KEY, encrypted, { ttl: TOKEN_TTL, tags: ["jarvis-google"] }); } catch {}

  const supabase = serviceClient();
  const id = await workspaceId();
  if (!supabase || !id) return;
  await supabase.from("jarvis_state_snapshots").upsert({
    workspace_id: id,
    state_key: TOKEN_STATE_KEY,
    version: 1,
    payload: { format: "encrypted-oauth-v1", data: encrypted },
    source: "GOOGLE WORKSPACE OAUTH",
    client_updated_at: record.updatedAt,
  }, { onConflict: "workspace_id,state_key" });
}

export async function getGoogleTokenRecord() {
  const encrypted = await loadEncrypted();
  return encrypted ? decrypt(encrypted) : null;
}

export function googleRedirectUri(requestUrl: string) {
  return process.env.GOOGLE_REDIRECT_URI || new URL("/api/integrations/google/callback", requestUrl).toString();
}

export function buildGoogleAuthorizationUrl(requestUrl: string, state: string) {
  if (!googleConfigured()) throw new Error("Google OAuth client is not configured.");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", googleRedirectUri(requestUrl));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

async function fetchGoogleProfile(accessToken: string) {
  try {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body = await response.json() as { email?: string };
    return body.email?.trim() || null;
  } catch {
    return null;
  }
}

export async function exchangeGoogleCode(code: string, requestUrl: string) {
  if (!googleConfigured()) throw new Error("Google OAuth client is not configured.");
  const previous = await getGoogleTokenRecord();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      code,
      grant_type: "authorization_code",
      redirect_uri: googleRedirectUri(requestUrl),
    }),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({})) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error_description?: string;
  };
  if (!response.ok || !body.access_token) throw new Error(body.error_description || "Google token exchange failed.");

  const refreshToken = body.refresh_token || previous?.refreshToken;
  if (!refreshToken) throw new Error("Google did not return a refresh token. Reconnect with consent enabled.");

  const email = await fetchGoogleProfile(body.access_token);
  const record: GoogleTokenRecord = {
    accessToken: body.access_token,
    refreshToken,
    expiresAt: Date.now() + Math.max(60, body.expires_in ?? 3600) * 1000,
    scope: (body.scope || GOOGLE_SCOPES.join(" ")).split(/\s+/).filter(Boolean),
    email: email || previous?.email || null,
    updatedAt: new Date().toISOString(),
  };
  await saveRecord(record);
  return record;
}

async function refreshGoogleAccessToken(record: GoogleTokenRecord) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: record.refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({})) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
    error_description?: string;
  };
  if (!response.ok || !body.access_token) throw new Error(body.error_description || "Google token refresh failed.");

  const next: GoogleTokenRecord = {
    ...record,
    accessToken: body.access_token,
    expiresAt: Date.now() + Math.max(60, body.expires_in ?? 3600) * 1000,
    scope: body.scope ? body.scope.split(/\s+/).filter(Boolean) : record.scope,
    updatedAt: new Date().toISOString(),
  };
  await saveRecord(next);
  return next;
}

export async function googleAccessToken() {
  const record = await getGoogleTokenRecord();
  if (!record) return null;
  if (record.expiresAt > Date.now() + 90_000) return { token: record.accessToken, record };
  const refreshed = await refreshGoogleAccessToken(record);
  return { token: refreshed.accessToken, record: refreshed };
}

export async function getGoogleWorkspaceStatus() {
  const record = await getGoogleTokenRecord();
  return {
    configured: googleConfigured(),
    connected: Boolean(record?.refreshToken),
    email: record?.email ?? null,
    scopes: record?.scope ?? [],
    updatedAt: record?.updatedAt ?? null,
    redirectUriConfigured: process.env.GOOGLE_REDIRECT_URI ?? null,
  };
}

function header(headers: Array<{ name?: string; value?: string }> | undefined, name: string) {
  return headers?.find(item => item.name?.toLowerCase() === name.toLowerCase())?.value?.trim() || null;
}

export async function syncGoogleWorkspace() {
  const auth = await googleAccessToken();
  if (!auth) throw new Error("Google Workspace is not connected.");
  const headers = { Authorization: `Bearer ${auth.token}` };

  const now = new Date();
  const timeMax = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000);
  const calendarUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  calendarUrl.searchParams.set("timeMin", now.toISOString());
  calendarUrl.searchParams.set("timeMax", timeMax.toISOString());
  calendarUrl.searchParams.set("singleEvents", "true");
  calendarUrl.searchParams.set("orderBy", "startTime");
  calendarUrl.searchParams.set("maxResults", "40");

  const gmailUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  gmailUrl.searchParams.set("maxResults", "16");
  gmailUrl.searchParams.set("q", "newer_than:14d -in:spam -in:trash");

  const [calendarResponse, gmailListResponse] = await Promise.all([
    fetch(calendarUrl, { headers, cache: "no-store" }),
    fetch(gmailUrl, { headers, cache: "no-store" }),
  ]);

  if (!calendarResponse.ok) throw new Error(`Google Calendar sync failed with HTTP ${calendarResponse.status}.`);
  if (!gmailListResponse.ok) throw new Error(`Gmail sync failed with HTTP ${gmailListResponse.status}.`);

  const calendarBody = await calendarResponse.json() as {
    items?: Array<{
      id?: string;
      summary?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      status?: string;
      location?: string;
      hangoutLink?: string;
      htmlLink?: string;
      organizer?: { email?: string; displayName?: string };
      attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string }>;
      updated?: string;
    }>;
  };
  const gmailList = await gmailListResponse.json() as { messages?: Array<{ id?: string }> };

  const calendar: CalendarEventSnapshot[] = (calendarBody.items ?? []).flatMap(item => {
    if (!item.id || !item.start?.dateTime && !item.start?.date) return [];
    const startAt = item.start.dateTime || item.start.date!;
    const endAt = item.end?.dateTime || item.end?.date || null;
    const status: CalendarEventSnapshot["status"] =
      item.status === "cancelled" ? "CANCELLED" :
      item.status === "tentative" ? "TENTATIVE" : "CONFIRMED";
    return [{
      id: item.id,
      title: item.summary?.trim() || "Untitled event",
      startAt,
      endAt,
      status,
      location: item.location?.trim() || null,
      joinUrl: item.hangoutLink?.trim() || item.htmlLink?.trim() || null,
      organizer: item.organizer?.displayName?.trim() || item.organizer?.email?.trim() || null,
      attendees: (item.attendees ?? []).slice(0, 40).map(person => ({
        name: person.displayName?.trim() || null,
        email: person.email?.trim() || null,
        response: person.responseStatus?.trim() || null,
      })),
      source: "Google Calendar",
      updatedAt: item.updated || new Date().toISOString(),
    }];
  });

  const messageIds = (gmailList.messages ?? []).flatMap(message => message.id ? [message.id] : []).slice(0, 16);
  const communications: CommunicationSignal[] = (await Promise.all(messageIds.map(async id => {
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`);
    url.searchParams.set("format", "metadata");
    for (const key of ["From", "Subject", "Date"]) url.searchParams.append("metadataHeaders", key);
    const response = await fetch(url, { headers, cache: "no-store" });
    if (!response.ok) return null;
    const message = await response.json() as {
      id?: string;
      snippet?: string;
      internalDate?: string;
      payload?: { headers?: Array<{ name?: string; value?: string }> };
    };
    const receivedAt = message.internalDate && Number.isFinite(Number(message.internalDate))
      ? new Date(Number(message.internalDate)).toISOString()
      : (() => {
          const raw = header(message.payload?.headers, "Date");
          const parsed = raw ? Date.parse(raw) : NaN;
          return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
        })();
    return {
      id: message.id || id,
      channel: "EMAIL" as const,
      from: header(message.payload?.headers, "From"),
      subject: header(message.payload?.headers, "Subject"),
      summary: message.snippet?.trim() || "Email received.",
      receivedAt,
      relatedEventId: null,
      source: "Gmail",
    };
  }))).filter((item): item is CommunicationSignal => Boolean(item));

  const current = await getAssistantRuntimeState();
  const state = await setAssistantRuntimeState({
    sources: {
      ...current.sources,
      calendar: "CONNECTED",
      email: "CONNECTED",
    },
    calendar: { asOf: new Date().toISOString(), events: calendar },
    communications: { asOf: new Date().toISOString(), recent: communications },
  });

  return {
    state,
    calendarCount: calendar.length,
    emailCount: communications.length,
    email: auth.record.email,
  };
}

function base64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function mimeMessage(to: string, subject: string, body: string) {
  const safeTo = to.replace(/[\r\n]/g, " ").trim();
  const safeSubject = subject.replace(/[\r\n]/g, " ").trim();
  return [
    `To: ${safeTo}`,
    `Subject: ${safeSubject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    body,
  ].join("\r\n");
}

export async function createGmailDraft(input: { to: string; subject: string; body: string }) {
  const auth = await googleAccessToken();
  if (!auth) throw new Error("Google Workspace is not connected.");
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw: base64Url(mimeMessage(input.to, input.subject, input.body)) } }),
  });
  const body = await response.json().catch(() => ({})) as { id?: string; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || "Gmail draft creation failed.");
  return { id: body.id ?? null };
}

export async function sendGmailMessage(input: { to: string; subject: string; body: string }) {
  const auth = await googleAccessToken();
  if (!auth) throw new Error("Google Workspace is not connected.");
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: base64Url(mimeMessage(input.to, input.subject, input.body)) }),
  });
  const body = await response.json().catch(() => ({})) as { id?: string; threadId?: string; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || "Gmail send failed.");
  return { id: body.id ?? null, threadId: body.threadId ?? null };
}

export async function createCalendarEvent(input: {
  title: string;
  startAt: string;
  endAt: string;
  location?: string | null;
  description?: string | null;
  attendees?: string[];
}) {
  const auth = await googleAccessToken();
  if (!auth) throw new Error("Google Workspace is not connected.");
  const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all", {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: input.title,
      start: { dateTime: input.startAt },
      end: { dateTime: input.endAt },
      location: input.location || undefined,
      description: input.description || undefined,
      attendees: (input.attendees ?? []).filter(Boolean).map(email => ({ email })),
    }),
  });
  const body = await response.json().catch(() => ({})) as { id?: string; htmlLink?: string; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || "Google Calendar event creation failed.");
  return { id: body.id ?? null, htmlLink: body.htmlLink ?? null };
}
