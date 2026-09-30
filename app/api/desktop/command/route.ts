import {
  enqueueDesktopCommand,
  getDesktopCommandResult,
  type LocalAgentDesktopAction,
} from "../../../../lib/trading-device-link";

export const runtime = "nodejs";

function bearer(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

const ACTIONS: LocalAgentDesktopAction[] = [
  "GET_CONTEXT",
  "OPEN_APP",
  "FOCUS_WINDOW",
  "OPEN_PATH",
  "OPEN_URI",
  "CLIPBOARD_READ",
  "CLIPBOARD_WRITE",
  "UI_CLICK_TEXT",
  "UI_TYPE_TEXT",
  "RUN_APPROVED_COMMAND",
];

const READ_ONLY = new Set<LocalAgentDesktopAction>(["GET_CONTEXT", "CLIPBOARD_READ"]);

export async function POST(request: Request) {
  const controllerToken = bearer(request);
  if (!controllerToken) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null) as {
    action?: LocalAgentDesktopAction;
    target?: string | null;
    text?: string | null;
    args?: string[];
    userAuthorized?: boolean;
  } | null;

  if (!body?.action || !ACTIONS.includes(body.action)) {
    return Response.json({ ok: false, error: "Invalid desktop action." }, { status: 400 });
  }

  const userAuthorized = body.userAuthorized === true;
  if (!READ_ONLY.has(body.action) && !userAuthorized) {
    return Response.json({
      ok: false,
      error: "This desktop action requires explicit user authorization.",
      requiresApproval: true,
    }, { status: 409 });
  }

  const command = await enqueueDesktopCommand(controllerToken, {
    action: body.action,
    target: body.target,
    text: body.text,
    args: body.args,
    authorization: READ_ONLY.has(body.action) ? "READ_ONLY" : "USER_AUTHORIZED",
  });

  if (!command) {
    return Response.json({ ok: false, error: "Local Agent is not paired or command is invalid." }, { status: 401 });
  }

  return Response.json({ ok: true, command }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request) {
  const controllerToken = bearer(request);
  if (!controllerToken) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");
  const state = await getDesktopCommandResult(controllerToken, id);
  if (!state) return Response.json({ ok: false, error: "Local Agent is not paired." }, { status: 401 });

  return Response.json({ ok: true, ...state }, {
    headers: { "Cache-Control": "no-store" },
  });
}
