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

function normalizeDomain(value: unknown): RuntimeDomain {
  const domain = typeof value === "string" ? value.toUpperCase() : "CORE";
  if (domain === "TRADING" || domain === "FINANCE" || domain === "SENTRYOPS" || domain === "LIFE") return domain;
  return "CORE";
}
