import { requestIsOwner } from "../../../../lib/owner-auth";
import {
  executiveProviderStatus,
  runExecutiveSession,
  type ExecutiveLeadPreference,
} from "../../../../lib/executive-session";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!requestIsOwner(request)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return Response.json({ ok: true, executive: executiveProviderStatus() }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  if (!requestIsOwner(request)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as {
    objective?: string;
    context?: string;
    preferredLead?: ExecutiveLeadPreference;
  };

  const objective = typeof body.objective === "string" ? body.objective.trim() : "";
  if (objective.length < 8) {
    return Response.json({ ok: false, error: "objective must be at least 8 characters" }, { status: 400 });
  }

  const preferredLead: ExecutiveLeadPreference =
    body.preferredLead === "GPT" || body.preferredLead === "CLAUDE" ? body.preferredLead : "AUTO";

  try {
    const session = await runExecutiveSession({
      objective,
      context: typeof body.context === "string" ? body.context : "",
      preferredLead,
      signal: request.signal,
    });
    return Response.json({ ok: true, session }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Executive session failed.",
    }, { status: 500 });
  }
}
