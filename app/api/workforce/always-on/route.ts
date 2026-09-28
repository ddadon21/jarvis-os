import { start } from "workflow/api";
import { getOrSeedWorkforceState } from "../../../../lib/jarvis-workforce";
import { setWorkforceState } from "../../../../lib/jarvis-runtime";
import { jarvisWorkforceLoop } from "../../../../workflows/jarvis-workforce-loop";

export const runtime = "nodejs";

type Body = { action?: "START" | "STOP"; cadenceMinutes?: number };

export async function GET() {
  const workforce = await getOrSeedWorkforceState();
  return Response.json({
    ok: true,
    autonomy: workforce.autonomy ?? {
      enabled: false,
      runId: null,
      startedAt: null,
      cadenceMinutes: 60,
    },
    lastCycleAt: workforce.lastCycleAt,
    status: workforce.status,
  });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const action = body.action ?? "START";
  const cadenceMinutes = Math.min(240, Math.max(15, Math.floor(body.cadenceMinutes ?? 60)));
  const workforce = await getOrSeedWorkforceState();

  if (action === "STOP") {
    const next = {
      ...workforce,
      autonomy: {
        enabled: false,
        runId: workforce.autonomy?.runId ?? null,
        startedAt: workforce.autonomy?.startedAt ?? null,
        cadenceMinutes: workforce.autonomy?.cadenceMinutes ?? cadenceMinutes,
      },
    };
    await setWorkforceState(next);
    return Response.json({
      ok: true,
      autonomy: next.autonomy,
      note: "The durable workforce will stop at its next checkpoint.",
    });
  }

  if (workforce.autonomy?.enabled && workforce.autonomy.runId) {
    return Response.json({ ok: true, autonomy: workforce.autonomy, alreadyRunning: true });
  }

  const run = await start(jarvisWorkforceLoop, [cadenceMinutes]);
  const now = new Date().toISOString();
  const next = {
    ...workforce,
    autonomy: {
      enabled: true,
      runId: run.runId,
      startedAt: now,
      cadenceMinutes,
    },
  };
  await setWorkforceState(next);

  return Response.json({
    ok: true,
    autonomy: next.autonomy,
    note: "Durable JARVIS workforce started.",
  });
}

function isAuthorized(request: Request) {
  const configuredSecret = process.env.JARVIS_WORKFORCE_SECRET || process.env.JARVIS_EVENT_SECRET;
  const authorization = request.headers.get("authorization");
  if (configuredSecret && authorization === `Bearer ${configuredSecret}`) return true;

  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin === url.origin && (fetchSite === "same-origin" || fetchSite === "same-site")) return true;

  return process.env.VERCEL_ENV !== "production" && url.searchParams.get("manual") === "1";
}
