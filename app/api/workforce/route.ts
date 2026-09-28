import { addWorkforceTask, getOrSeedWorkforceState, runWorkforceCycle } from "../../../lib/jarvis-workforce";
import type { AgentId, AgentPermission, AgentTaskPriority, RuntimeDomain } from "../../../lib/jarvis-runtime";

export const runtime = "nodejs";
export const maxDuration = 300;

type WorkforceBody = {
  action?: "RUN_CYCLE" | "ADD_TASK";
  title?: string;
  domain?: RuntimeDomain;
  assignedTo?: AgentId;
  priority?: AgentTaskPriority;
  permissionRequired?: AgentPermission;
  objectiveId?: string | null;
};

export async function GET() {
  const state = await getOrSeedWorkforceState();
  return Response.json({
    ok: true,
    workforce: state,
    counts: {
      agents: state.agents.length,
      activeObjectives: state.objectives.filter((objective) => objective.status === "ACTIVE").length,
      queuedTasks: (state.tasks ?? []).filter((task) => task.status === "QUEUED").length,
      runningTasks: (state.tasks ?? []).filter((task) => task.status === "RUNNING").length,
      blockedTasks: (state.tasks ?? []).filter((task) => ["BLOCKED", "FAILED", "WAITING_APPROVAL"].includes(task.status)).length,
    },
  });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as WorkforceBody;

  if (body.action === "RUN_CYCLE") {
    const workforce = await runWorkforceCycle();
    return Response.json({ ok: true, workforce });
  }

  if (body.action === "ADD_TASK") {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return Response.json({ ok: false, error: "title is required" }, { status: 400 });

    const task = await addWorkforceTask({
      title,
      domain: body.domain,
      assignedTo: body.assignedTo,
      priority: body.priority,
      permissionRequired: body.permissionRequired,
      objectiveId: body.objectiveId,
      source: "jarvis.workforce.ui",
    });
    return Response.json({ ok: true, task });
  }

  return Response.json({ ok: false, error: "Unsupported workforce action" }, { status: 400 });
}

function isAuthorized(request: Request) {
  const configuredSecret = process.env.JARVIS_WORKFORCE_SECRET || process.env.JARVIS_OBJECTIVE_SECRET || process.env.JARVIS_EVENT_SECRET;
  const authorization = request.headers.get("authorization");
  if (configuredSecret) return authorization === `Bearer ${configuredSecret}`;

  if (process.env.VERCEL_ENV !== "production") {
    const url = new URL(request.url);
    return url.searchParams.get("manual") === "1";
  }

  return false;
}
