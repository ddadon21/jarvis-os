import { runWorkforceCycle } from "../../../../lib/jarvis-workforce";
import { getLastPulseAt, shouldRunPulse } from "../../../../lib/jarvis-runtime";

export const runtime = "nodejs";
export const maxDuration = 300;

const MINIMUM_MINUTES_BETWEEN_PULSES = 240;

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const lastPulseAt = await getLastPulseAt();
  const url = new URL(request.url);
  const previewForce = process.env.VERCEL_ENV !== "production" && url.searchParams.get("force") === "1";

  if (!previewForce && !shouldRunPulse(lastPulseAt, MINIMUM_MINUTES_BETWEEN_PULSES)) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: "A Jarvis workforce cycle completed recently; duplicate work was suppressed.",
      lastPulseAt,
    });
  }

  const workforce = await runWorkforceCycle();
  return Response.json({ ok: workforce.status !== "DEGRADED", skipped: false, workforce });
}

function isAuthorized(request: Request): boolean {
  const configuredSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (configuredSecret) {
    return authorization === `Bearer ${configuredSecret}`;
  }

  if (request.headers.get("x-vercel-cron-schedule")) return true;

  if (process.env.VERCEL_ENV !== "production") {
    const url = new URL(request.url);
    return url.searchParams.get("manual") === "1";
  }

  return false;
}
