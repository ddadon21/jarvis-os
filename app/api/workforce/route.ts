import { requestIsOwner } from "../../../lib/owner-auth";
import { addWorkforceTask, getOrSeedWorkforceState, runWorkforceCycle } from "../../../lib/jarvis-workforce";
import { getRecentEvents, type AgentId, type AgentPermission, type AgentTaskPriority, type RuntimeDomain } from "../../../lib/jarvis-runtime";

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
  const [state, recentEvents] = await Promise.all([
    getOrSeedWorkforceState(),
    getRecentEvents(),
  ]);
  return Response.json({
    ok: true,
    workforce: state,
    recentEvents: recentEvents.slice(0, 24),
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
  // Middleware verified the owner session or an automation secret.
  return requestIsOwner(request);
}
