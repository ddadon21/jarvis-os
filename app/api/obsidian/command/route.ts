import {
  enqueueObsidianCommand,
  getObsidianCommandResult,
  LocalAgentObsidianAction,
} from "../../../../lib/trading-device-link";

export const runtime = "nodejs";

function bearer(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

export async function POST(request: Request) {
  const controllerToken = bearer(request);
  if (!controllerToken) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null) as {
    action?: LocalAgentObsidianAction;
    path?: string | null;
    content?: string | null;
  } | null;

  if (!body?.action || !["LIST", "READ", "WRITE"].includes(body.action)) {
    return Response.json({ ok: false, error: "Invalid action" }, { status: 400 });
  }

  const command = await enqueueObsidianCommand(controllerToken, {
    action: body.action,
    path: body.path,
    content: body.content,
  });

  if (!command) return Response.json({ ok: false, error: "Local Agent is not paired or command is invalid." }, { status: 401 });
  return Response.json({ ok: true, command });
}

export async function GET(request: Request) {
  const controllerToken = bearer(request);
  if (!controllerToken) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  const state = await getObsidianCommandResult(controllerToken, id);
  if (!state) return Response.json({ ok: false, error: "Local Agent is not paired." }, { status: 401 });
  return Response.json({ ok: true, ...state });
}
