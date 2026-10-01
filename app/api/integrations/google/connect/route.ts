import { randomBytes } from "node:crypto";
import { buildGoogleAuthorizationUrl, getGoogleWorkspaceStatus } from "../../../../../lib/google-workspace";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const status = await getGoogleWorkspaceStatus();
  if (!status.configured) {
    return Response.json({
      ok: false,
      error: "Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.",
    }, { status: 503 });
  }

  const state = randomBytes(24).toString("base64url");
  const location = buildGoogleAuthorizationUrl(request.url, state);
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
      "Set-Cookie": `jarvis_google_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}
