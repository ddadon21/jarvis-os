import { cronAuthorized } from "../../../../lib/owner-auth";
import { runWorkforceCycle } from "../../../../lib/jarvis-workforce";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const workforce = await runWorkforceCycle();
  return Response.json({
    ok: workforce.status !== "DEGRADED",
    mode: "24X7_HEARTBEAT",
    ranAt: workforce.lastCycleAt,
    workforce,
  });
}

function isAuthorized(request: Request) {
  return cronAuthorized(request);
}
