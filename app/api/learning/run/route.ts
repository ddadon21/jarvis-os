import { runAndStoreLearning } from "../../../../lib/learning/service.ts";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Owner-only: run the learning pipeline now. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { family?: string };
  try {
    const result = await runAndStoreLearning(body.family ?? null);
    if (!result.report) return Response.json({ ok: false, family: result.family, error: result.reason }, { status: 409 });
    const { pine, ...report } = result.report;
    return Response.json({ ok: true, id: result.id, family: result.family, report: { ...report, hasPine: Boolean(pine) } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Learning run failed." }, { status: 500 });
  }
}
