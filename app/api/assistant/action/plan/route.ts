import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { JARVIS_MODELS } from "../../../../../lib/jarvis-models";

export const runtime = "nodejs";

type PlannedAction =
  | { type: "NONE"; message: string }
  | { type: "SYNC_GOOGLE"; message: string }
  | { type: "CREATE_GMAIL_DRAFT"; to: string; subject: string; messageBody: string; message: string }
  | { type: "SEND_GMAIL"; to: string; subject: string; messageBody: string; message: string }
  | {
      type: "CREATE_CALENDAR_EVENT";
      title: string;
      startAt: string;
      endAt: string;
      location: string | null;
      description: string | null;
      attendees: string[];
      message: string;
    };

function strongIntent(text: string) {
  const lower = text.toLowerCase();
  if (/\b(sync|refresh|update)\b.*\b(calendar|gmail|google workspace|email)\b/.test(lower)) return "SYNC_GOOGLE";
  if (/\b(draft|write|compose)\b.*\b(email|mail)\b/.test(lower)) return "CREATE_GMAIL_DRAFT";
  if (/\b(send|email|mail)\b.*\b(to|@)\b/.test(lower) || /\bsend\b.*\b(email|mail)\b/.test(lower)) return "SEND_GMAIL";
  if (/\b(schedule|book|create|add|put)\b.*\b(calendar|meeting|appointment|event|call)\b/.test(lower)) return "CREATE_CALENDAR_EVENT";
  return "NONE";
}

function extractJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>; } catch { return null; }
}

function validEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function clean(value: unknown, max = 4000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    text?: string;
    localNow?: string;
    timeZone?: string;
  } | null;
  const text = body?.text?.trim() || "";
  if (!text) return Response.json({ ok: false, error: "Missing command." }, { status: 400 });

  const intent = strongIntent(text);
  if (intent === "NONE") return Response.json({ ok: true, action: { type: "NONE", message: "" } satisfies PlannedAction });

  if (intent === "SYNC_GOOGLE") {
    return Response.json({ ok: true, action: { type: "SYNC_GOOGLE", message: "I’ll refresh Google Calendar and Gmail." } satisfies PlannedAction });
  }

  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ ok: false, error: "The action planner requires the direct OpenAI provider." }, { status: 503 });
  }

  const localNow = clean(body?.localNow, 80) || new Date().toISOString();
  const timeZone = clean(body?.timeZone, 80) || "America/New_York";
  const result = await generateText({
    model: openai(JARVIS_MODELS.gptFast),
    system: [
      "You are a strict structured action parser for JARVIS.",
      "Never invent an email address, attendee, date, time, subject, title, or location.",
      "The user's explicit verb is an authorization ceiling and must not be upgraded.",
      "If the intent is draft, output CREATE_GMAIL_DRAFT only.",
      "If the intent is send, output SEND_GMAIL only.",
      "If the intent is calendar creation, output CREATE_CALENDAR_EVENT only.",
      "If any required fact is missing or ambiguous, output NONE with a short question in message.",
      "Resolve relative dates such as tomorrow using LOCAL NOW and TIME ZONE.",
      "For calendar events, if a start time is explicit but duration/end is omitted, default to 60 minutes.",
      "Do not infer email addresses from names.",
      "Return JSON only.",
    ].join("\n"),
    prompt: [
      "AUTHORIZED INTENT CEILING: " + intent,
      "LOCAL NOW: " + localNow,
      "TIME ZONE: " + timeZone,
      "USER COMMAND: " + text,
      "",
      'Schema: {"type":"NONE|CREATE_GMAIL_DRAFT|SEND_GMAIL|CREATE_CALENDAR_EVENT","to":"","subject":"","messageBody":"","title":"","startAt":"","endAt":"","location":null,"description":null,"attendees":[],"message":""}',
      "Calendar timestamps must include an offset or Z.",
    ].join("\n"),
    maxOutputTokens: 600,
  });

  const raw = extractJson(result.text);
  if (!raw) return Response.json({ ok: true, action: { type: "NONE", message: "I need a little more detail before I can do that safely." } satisfies PlannedAction });

  const returnedType = clean(raw.type, 50);
  if (returnedType !== intent) {
    return Response.json({
      ok: true,
      action: { type: "NONE", message: clean(raw.message, 300) || "I need the missing details before I can do that safely." } satisfies PlannedAction,
    });
  }

  if (intent === "CREATE_GMAIL_DRAFT" || intent === "SEND_GMAIL") {
    const to = clean(raw.to, 320);
    const subject = clean(raw.subject, 300);
    const messageBody = clean(raw.messageBody, 12_000);
    if (!validEmail(to) || !subject || !messageBody) {
      return Response.json({
        ok: true,
        action: { type: "NONE", message: clean(raw.message, 300) || "Give me the recipient email, subject, and message." } satisfies PlannedAction,
      });
    }
    const action: PlannedAction = {
      type: intent,
      to,
      subject,
      messageBody,
      message: clean(raw.message, 300) || (intent === "SEND_GMAIL" ? "Email ready to send." : "Draft ready."),
    };
    return Response.json({ ok: true, action });
  }

  const title = clean(raw.title, 300);
  const startAt = clean(raw.startAt, 100);
  const endAt = clean(raw.endAt, 100);
  if (!title || !Number.isFinite(Date.parse(startAt)) || !Number.isFinite(Date.parse(endAt)) || Date.parse(endAt) <= Date.parse(startAt)) {
    return Response.json({
      ok: true,
      action: { type: "NONE", message: clean(raw.message, 300) || "Tell me the event title and exact time." } satisfies PlannedAction,
    });
  }
  const attendees = Array.isArray(raw.attendees) ? raw.attendees.filter(validEmail).slice(0, 20) : [];
  const action: PlannedAction = {
    type: "CREATE_CALENDAR_EVENT",
    title,
    startAt,
    endAt,
    location: clean(raw.location, 500) || null,
    description: clean(raw.description, 4000) || null,
    attendees,
    message: clean(raw.message, 300) || "Calendar event ready.",
  };
  return Response.json({ ok: true, action });
}
