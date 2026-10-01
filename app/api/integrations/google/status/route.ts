import { getGoogleWorkspaceStatus } from "../../../../../lib/google-workspace";

export const runtime = "nodejs";

export async function GET() {
  const status = await getGoogleWorkspaceStatus();
  return Response.json({ ok: true, ...status }, { headers: { "Cache-Control": "no-store" } });
}
