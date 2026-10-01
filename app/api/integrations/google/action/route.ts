import { createCalendarEvent, createGmailDraft, sendGmailMessage } from "../../../../../lib/google-workspace";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    action?: "CREATE_GMAIL_DRAFT" | "SEND_GMAIL" | "CREATE_CALENDAR_EVENT";
    approved?: boolean;
    to?: string;
    subject?: string;
    message?: string;
    title?: string;
    startAt?: string;
    endAt?: string;
    location?: string | null;
    description?: string | null;
    attendees?: string[];
  } | null;

  if (!body?.action) return Response.json({ ok: false, error: "Missing Google action." }, { status: 400 });

  try {
    if (body.action === "CREATE_GMAIL_DRAFT") {
      if (!body.to || !body.subject || !body.message) {
        return Response.json({ ok: false, error: "Draft requires to, subject, and message." }, { status: 400 });
      }
      const result = await createGmailDraft({ to: body.to, subject: body.subject, body: body.message });
      return Response.json({ ok: true, action: body.action, result });
    }

    if (body.approved !== true) {
      return Response.json({
        ok: false,
        error: "This external Google action requires explicit user approval.",
        requiresApproval: true,
      }, { status: 409 });
    }

    if (body.action === "SEND_GMAIL") {
      if (!body.to || !body.subject || !body.message) {
        return Response.json({ ok: false, error: "Send requires to, subject, and message." }, { status: 400 });
      }
      const result = await sendGmailMessage({ to: body.to, subject: body.subject, body: body.message });
      return Response.json({ ok: true, action: body.action, result });
    }

    if (body.action === "CREATE_CALENDAR_EVENT") {
      if (!body.title || !body.startAt || !body.endAt) {
        return Response.json({ ok: false, error: "Calendar event requires title, startAt, and endAt." }, { status: 400 });
      }
      if (!Number.isFinite(Date.parse(body.startAt)) || !Number.isFinite(Date.parse(body.endAt))) {
        return Response.json({ ok: false, error: "Calendar event times must be valid ISO timestamps." }, { status: 400 });
      }
      const result = await createCalendarEvent({
        title: body.title,
        startAt: body.startAt,
        endAt: body.endAt,
        location: body.location,
        description: body.description,
        attendees: body.attendees,
      });
      return Response.json({ ok: true, action: body.action, result });
    }

    return Response.json({ ok: false, error: "Unsupported Google action." }, { status: 400 });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Google action failed.",
    }, { status: 502 });
  }
}
