import { runJarvisPulse } from "../../../../lib/jarvis-pulse";
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
      reason: "A Jarvis pulse completed recently; duplicate work was suppressed.",
      lastPulseAt,
    });
  }

  const pulse = await runJarvisPulse();
  return Response.json({ ok: pulse.status !== "ERROR", skipped: false, pulse });
}

function isAuthorized(request: Request): boolean {
  const configuredSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (configuredSecret) {
    return authorization === `Bearer ${configuredSecret}`;
  }

  // Vercel sets this header on scheduled Cron requests. This is an interim fallback
  // until CRON_SECRET is configured in the production project.
  if (request.headers.get("x-vercel-cron-schedule")) return true;

  // Manual execution is allowed only on preview/development deployments for testing.
  if (process.env.VERCEL_ENV !== "production") {
    const url = new URL(request.url);
    return url.searchParams.get("manual") === "1";
  }

  return false;
}
