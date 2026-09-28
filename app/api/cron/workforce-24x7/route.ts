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
  const configuredSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (configuredSecret) return authorization === `Bearer ${configuredSecret}`;
  if (request.headers.get("x-vercel-cron-schedule")) return true;

  if (process.env.VERCEL_ENV !== "production") {
    const url = new URL(request.url);
    return url.searchParams.get("manual") === "1";
  }

  return false;
}
