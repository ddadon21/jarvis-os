import { listModelRuns, setModelStatus, type ModelStatus } from "../../../../../lib/learning/store.ts";

export const runtime = "nodejs";

/** Owner-only: fetch a model's generated Pine (download) or change its status. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const run = (await listModelRuns(200)).find((item) => item.id === id);
  if (!run?.report.pine) return Response.json({ ok: false, error: "Model or Pine not found." }, { status: 404 });
  return new Response(run.report.pine, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="deviant-learned-${id}.pine"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { status?: ModelStatus } | null;
  const status = body?.status;
  if (status !== "SHADOW" && status !== "REJECTED" && status !== "CANDIDATE" && status !== "PROMOTED") {
    return Response.json({ ok: false, error: "status must be SHADOW, CANDIDATE, REJECTED or PROMOTED." }, { status: 400 });
  }
  try {
    await setModelStatus(id, status);
    return Response.json({ ok: true, id, status });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Update failed." }, { status: 500 });
  }
}
