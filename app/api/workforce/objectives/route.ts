import { addWorkforceObjective, getOrSeedWorkforceState } from "../../../../lib/jarvis-workforce";
import { RuntimeDomain } from "../../../../lib/jarvis-runtime";

export const runtime = "nodejs";

type ObjectiveBody = {
  title?: string;
  domain?: RuntimeDomain;
  successDefinition?: string;
  currentFocus?: string;
};

export async function GET() {
  const state = await getOrSeedWorkforceState();
  return Response.json({ objectives: state.objectives, workforceStatus: state.status, lastCycleAt: state.lastCycleAt });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as ObjectiveBody;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return Response.json({ ok: false, error: "title is required" }, { status: 400 });

  const objective = await addWorkforceObjective({
    title,
    domain: normalizeDomain(body.domain),
    successDefinition: body.successDefinition,
    currentFocus: body.currentFocus,
  });

  return Response.json({ ok: true, objective });
}

function isAuthorized(request: Request) {
  const configuredSecret = process.env.JARVIS_OBJECTIVE_SECRET || process.env.JARVIS_EVENT_SECRET;
  const authorization = request.headers.get("authorization");
  if (configuredSecret) return authorization === `Bearer ${configuredSecret}`;

  if (process.env.VERCEL_ENV !== "production") {
    const url = new URL(request.url);
    return url.searchParams.get("manual") === "1";
  }

  return false;
}

function normalizeDomain(value: unknown): RuntimeDomain {
  const domain = typeof value === "string" ? value.toUpperCase() : "CORE";
  if (domain === "TRADING" || domain === "FINANCE" || domain === "SENTRYOPS" || domain === "LIFE") return domain;
  return "CORE";
}
