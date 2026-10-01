import { getGoogleWorkspaceStatus, syncGoogleWorkspace } from "../../../../../lib/google-workspace";

export const runtime = "nodejs";

export async function POST() {
  const status = await getGoogleWorkspaceStatus();
  if (!status.configured) return Response.json({ ok: false, error: "Google OAuth app is not configured." }, { status: 503 });
  if (!status.connected) return Response.json({ ok: false, error: "Google Workspace is not authorized." }, { status: 409 });

  try {
    const result = await syncGoogleWorkspace();
    return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Google Workspace sync failed.",
    }, { status: 502 });
  }
}
