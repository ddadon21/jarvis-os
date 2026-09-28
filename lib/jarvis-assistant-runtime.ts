"server-only";

import { getCache } from "@vercel/functions";

export type AssistantConnectionState = "CONNECTED" | "NEEDS_CONNECTION" | "DEGRADED";

export type AssistantSourceState = {
  calendar: AssistantConnectionState;
  email: AssistantConnectionState;
  meetings: AssistantConnectionState;
  contacts: AssistantConnectionState;
  webSearch: AssistantConnectionState;
};

export type CalendarEventSnapshot = {
  id: string;
  title: string;
  startAt: string;
  endAt: string | null;
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  location: string | null;
  joinUrl: string | null;
  organizer: string | null;
  attendees: Array<{ name: string | null; email: string | null; response: string | null }>;
  source: string;
  updatedAt: string;
};

export type MeetingPresenceSnapshot = {
  eventId: string | null;
  meetingTitle: string | null;
  person: string | null;
  state: "WAITING" | "JOINED" | "LEFT" | "UNKNOWN";
  waitingSince: string | null;
  joinedAt: string | null;
  leftAt: string | null;
  source: string;
  updatedAt: string;
};

export type CommunicationSignal = {
  id: string;
  channel: "EMAIL" | "MEETING" | "MESSAGE";
  from: string | null;
  subject: string | null;
  summary: string;
  receivedAt: string;
  relatedEventId: string | null;
  source: string;
};

export type JarvisAssistantRuntime = {
  version: 1;
  updatedAt: string;
  sources: AssistantSourceState;
  calendar: {
    asOf: string | null;
    events: CalendarEventSnapshot[];
  };
  meetingPresence: {
    asOf: string | null;
    people: MeetingPresenceSnapshot[];
  };
  communications: {
    asOf: string | null;
    recent: CommunicationSignal[];
  };
};


export type AssistantAlert = {
  id: string;
  kind: "MEETING_SOON" | "PERSON_WAITING" | "MEETING_STARTED" | "COMMUNICATION";
  priority: "NORMAL" | "TIME_SENSITIVE" | "CRITICAL";
  message: string;
  occurredAt: string;
  relatedEventId: string | null;
};

export function getAssistantAlerts(state: JarvisAssistantRuntime, nowMs = Date.now()): AssistantAlert[] {
  const alerts: AssistantAlert[] = [];

  for (const event of state.calendar.events) {
    if (event.status === "CANCELLED" || !Number.isFinite(Date.parse(event.startAt))) continue;
    const start = Date.parse(event.startAt);
    const diffMinutes = Math.ceil((start - nowMs) / 60_000);

    if (diffMinutes >= 0 && diffMinutes <= 15) {
      const milestone = diffMinutes <= 1 ? "NOW" : diffMinutes <= 5 ? "5M" : "15M";
      alerts.push({
        id: "meeting-soon:" + event.id + ":" + milestone,
        kind: "MEETING_SOON",
        priority: diffMinutes <= 5 ? "CRITICAL" : "TIME_SENSITIVE",
        message: event.title + " starts " + (diffMinutes === 0 ? "now" : "in " + diffMinutes + " minute" + (diffMinutes === 1 ? "" : "s")) + ".",
        occurredAt: event.startAt,
        relatedEventId: event.id,
      });
    } else if (diffMinutes < 0 && diffMinutes >= -10) {
      alerts.push({
        id: "meeting-started:" + event.id,
        kind: "MEETING_STARTED",
        priority: "TIME_SENSITIVE",
        message: event.title + " started about " + Math.abs(diffMinutes) + " minute" + (Math.abs(diffMinutes) === 1 ? "" : "s") + " ago.",
        occurredAt: event.startAt,
        relatedEventId: event.id,
      });
    }
  }

  for (const person of state.meetingPresence.people) {
    if (person.state !== "WAITING") continue;
    const since = person.waitingSince && Number.isFinite(Date.parse(person.waitingSince))
      ? Date.parse(person.waitingSince)
      : Date.parse(person.updatedAt);
    const minutes = Number.isFinite(since) ? Math.max(0, Math.floor((nowMs - since) / 60_000)) : null;
    const milestone = minutes === null ? "NEW" : minutes < 5 ? "NEW" : Math.min(30, Math.floor(minutes / 5) * 5) + "M";
    alerts.push({
      id: "person-waiting:" + (person.eventId ?? person.person ?? person.updatedAt) + ":" + milestone,
      kind: "PERSON_WAITING",
      priority: minutes !== null && minutes >= 5 ? "CRITICAL" : "TIME_SENSITIVE",
      message: (person.person || "A guest") + " is waiting" + (minutes === null ? "." : " and has been waiting for about " + minutes + " minute" + (minutes === 1 ? "" : "s") + "."),
      occurredAt: person.waitingSince ?? person.updatedAt,
      relatedEventId: person.eventId,
    });
  }

  return alerts
    .sort((a, b) => {
      const rank = { CRITICAL: 0, TIME_SENSITIVE: 1, NORMAL: 2 } as const;
      return rank[a.priority] - rank[b.priority] || Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
    })
    .slice(0, 12);
}

const KEY = "jarvis:assistant:runtime:v1";
const TTL = 60 * 60 * 24 * 365;

const fallbackState: JarvisAssistantRuntime = {
  version: 1,
  updatedAt: new Date(0).toISOString(),
  sources: {
    calendar: "NEEDS_CONNECTION",
    email: "NEEDS_CONNECTION",
    meetings: "NEEDS_CONNECTION",
    contacts: "NEEDS_CONNECTION",
    webSearch: process.env.TAVILY_API_KEY ? "CONNECTED" : "NEEDS_CONNECTION",
  },
  calendar: { asOf: null, events: [] },
  meetingPresence: { asOf: null, people: [] },
  communications: { asOf: null, recent: [] },
};

export async function getAssistantRuntimeState(): Promise<JarvisAssistantRuntime> {
  try {
    const value = await getCache().get(KEY) as JarvisAssistantRuntime | null;
    if (!value) return {
      ...fallbackState,
      updatedAt: new Date().toISOString(),
      sources: {
        ...fallbackState.sources,
        webSearch: process.env.TAVILY_API_KEY ? "CONNECTED" : "NEEDS_CONNECTION",
      },
    };
    return value;
  } catch {
    return {
      ...fallbackState,
      updatedAt: new Date().toISOString(),
      sources: {
        ...fallbackState.sources,
        webSearch: process.env.TAVILY_API_KEY ? "CONNECTED" : "NEEDS_CONNECTION",
      },
    };
  }
}

export async function setAssistantRuntimeState(input: Partial<JarvisAssistantRuntime>): Promise<JarvisAssistantRuntime> {
  const current = await getAssistantRuntimeState();
  const now = new Date().toISOString();

  const next: JarvisAssistantRuntime = {
    version: 1,
    updatedAt: now,
    sources: {
      ...current.sources,
      ...(input.sources ?? {}),
      webSearch: process.env.TAVILY_API_KEY ? "CONNECTED" : (input.sources?.webSearch ?? current.sources.webSearch),
    },
    calendar: input.calendar ? {
      asOf: input.calendar.asOf ?? now,
      events: Array.isArray(input.calendar.events) ? input.calendar.events.slice(0, 100) : current.calendar.events,
    } : current.calendar,
    meetingPresence: input.meetingPresence ? {
      asOf: input.meetingPresence.asOf ?? now,
      people: Array.isArray(input.meetingPresence.people) ? input.meetingPresence.people.slice(0, 100) : current.meetingPresence.people,
    } : current.meetingPresence,
    communications: input.communications ? {
      asOf: input.communications.asOf ?? now,
      recent: Array.isArray(input.communications.recent) ? input.communications.recent.slice(0, 100) : current.communications.recent,
    } : current.communications,
  };

  try {
    await getCache().set(KEY, next, { ttl: TTL, tags: ["jarvis-assistant"] });
  } catch {
    // Runtime cache can be absent in local development. Callers still receive normalized state.
  }

  return next;
}
