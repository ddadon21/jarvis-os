"use client";

type AssistantAction =
  | { type: "NONE"; message?: string }
  | { type: "SYNC_GOOGLE"; message?: string }
  | { type: "CREATE_GMAIL_DRAFT"; to: string; subject: string; messageBody: string; message?: string }
  | { type: "SEND_GMAIL"; to: string; subject: string; messageBody: string; message?: string }
  | {
      type: "CREATE_CALENDAR_EVENT";
      title: string;
      startAt: string;
      endAt: string;
      location?: string | null;
      description?: string | null;
      attendees?: string[];
      message?: string;
    };

function couldBeGoogleAction(text: string) {
  const lower = text.toLowerCase();
  return (
    /\b(draft|write|compose|send|email|mail)\b.*\b(email|mail|to|@)\b/.test(lower) ||
    /\b(schedule|book|create|add|put)\b.*\b(calendar|meeting|appointment|event|call)\b/.test(lower) ||
    /\b(sync|refresh|update)\b.*\b(calendar|gmail|google workspace|email)\b/.test(lower)
  );
}

async function status() {
  const response = await fetch("/api/integrations/google/status", { cache: "no-store" });
  if (!response.ok) return null;
  return await response.json() as { configured?: boolean; connected?: boolean };
}

export async function tryExecuteGoogleWorkspaceText(text: string) {
  const clean = text.trim();
  if (!clean || !couldBeGoogleAction(clean)) return null;

  const google = await status().catch(() => null);
  if (!google?.connected) {
    return {
      handled: true,
      ok: false,
      message: google?.configured
        ? "Google Workspace is ready but not authorized yet. Use the Google Workspace panel to connect Calendar and Gmail once."
        : "Google Workspace still needs its OAuth app credentials before I can use Calendar or Gmail.",
    };
  }

  const planResponse = await fetch("/api/assistant/action/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: clean,
      localNow: new Date().toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
    }),
  });
  const planned = await planResponse.json().catch(() => ({})) as { action?: AssistantAction; error?: string };
  if (!planResponse.ok || !planned.action) {
    return { handled: true, ok: false, message: planned.error || "I couldn't safely interpret that Google Workspace action." };
  }

  const action = planned.action;
  if (action.type === "NONE") {
    return { handled: true, ok: false, message: action.message || "I need a little more detail before I can do that safely." };
  }

  if (action.type === "SYNC_GOOGLE") {
    const response = await fetch("/api/integrations/google/sync", { method: "POST" });
    const body = await response.json().catch(() => ({})) as { calendarCount?: number; emailCount?: number; error?: string };
    if (!response.ok) return { handled: true, ok: false, message: body.error || "Google Workspace sync failed." };
    window.dispatchEvent(new CustomEvent("jarvis-google-sync", {
      detail: { state: "SYNCED", reason: "command", at: new Date().toISOString() },
    }));
    return {
      handled: true,
      ok: true,
      message: `Google Workspace synced. ${body.calendarCount ?? 0} upcoming calendar events and ${body.emailCount ?? 0} recent email signals are now in Jarvis.`,
    };
  }

  const payload =
    action.type === "CREATE_GMAIL_DRAFT"
      ? { action: action.type, approved: false, to: action.to, subject: action.subject, message: action.messageBody }
      : action.type === "SEND_GMAIL"
        ? { action: action.type, approved: true, to: action.to, subject: action.subject, message: action.messageBody }
        : {
            action: action.type,
            approved: true,
            title: action.title,
            startAt: action.startAt,
            endAt: action.endAt,
            location: action.location ?? null,
            description: action.description ?? null,
            attendees: action.attendees ?? [],
          };

  const response = await fetch("/api/integrations/google/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({})) as {
    ok?: boolean;
    error?: string;
    result?: { id?: string | null };
  };
  if (!response.ok || !body.ok) return { handled: true, ok: false, message: body.error || "Google Workspace action failed." };

  window.dispatchEvent(new CustomEvent("jarvis-google-sync-now"));
  window.dispatchEvent(new CustomEvent("jarvis-obsidian-sync-now"));

  if (action.type === "CREATE_GMAIL_DRAFT") {
    return { handled: true, ok: true, message: `Draft created for ${action.to} with subject “${action.subject}”. I did not send it.` };
  }
  if (action.type === "SEND_GMAIL") {
    return { handled: true, ok: true, message: `Email sent to ${action.to} with subject “${action.subject}”.` };
  }
  return {
    handled: true,
    ok: true,
    message: `Calendar event created: ${action.title}, starting ${new Date(action.startAt).toLocaleString()}.`,
  };
}
