import { getJarvisCoreState } from "../../../../lib/jarvis-core";

export const runtime = "nodejs";

export async function GET() {
  const core = await getJarvisCoreState();
  return Response.json({ ok: true, core }, {
    headers: { "Cache-Control": "no-store" },
  });
}
