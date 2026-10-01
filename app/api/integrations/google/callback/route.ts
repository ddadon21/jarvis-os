import { exchangeGoogleCode, syncGoogleWorkspace } from "../../../../../lib/google-workspace";

export const runtime = "nodejs";

function cookie(request: Request, name: string) {
  const raw = request.headers.get("cookie") || "";
  for (const item of raw.split(";")) {
    const [key, ...rest] = item.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = cookie(request, "jarvis_google_oauth_state");
  const workUrl = new URL("/work", request.url);

  if (error) {
    workUrl.searchParams.set("google", "denied");
    workUrl.searchParams.set("reason", error.slice(0, 80));
    return Response.redirect(workUrl, 302);
  }
  if (!code || !state || !expected || state !== expected) {
    return Response.json({ ok: false, error: "Google OAuth state validation failed." }, { status: 400 });
  }

  try {
    await exchangeGoogleCode(code, request.url);
    try { await syncGoogleWorkspace(); } catch {}
    workUrl.searchParams.set("google", "connected");
    return new Response(null, {
      status: 302,
      headers: {
        Location: workUrl.toString(),
        "Cache-Control": "no-store",
        "Set-Cookie": "jarvis_google_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      },
    });
  } catch (oauthError) {
    workUrl.searchParams.set("google", "error");
    workUrl.searchParams.set("reason", oauthError instanceof Error ? oauthError.message.slice(0, 120) : "oauth_failed");
    return Response.redirect(workUrl, 302);
  }
}
