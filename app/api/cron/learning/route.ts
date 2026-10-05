import { cronAuthorized } from "../../../../lib/owner-auth";
import { replayShadowModel, runAndStoreLearning } from "../../../../lib/learning/service.ts";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Daily after the close: shadow-score the SHADOW model, then retrain (never auto-promotes). */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const shadow = await replayShadowModel().catch((error) => ({ error: error instanceof Error ? error.message : "shadow failed" }));
  const learning = await runAndStoreLearning(null).catch((error) => ({ error: error instanceof Error ? error.message : "learning failed" }));
  const summary = "report" in learning && learning.report
    ? { family: learning.family, id: learning.id, status: learning.report.status, message: learning.report.message }
    : learning;
  return Response.json({ ok: true, shadow, learning: summary });
}
