import { OWNER_COOKIE, SESSION_DAYS, createOwnerSession, ownerAuthConfigured, passcodeMatches } from "../../../../lib/owner-auth";

export const runtime = "nodejs";

const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 8;

function clientKey(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function POST(request: Request) {
  if (!ownerAuthConfigured()) {
    return Response.json({ ok: false, error: "Owner login is not configured. Set JARVIS_OWNER_PASSCODE in Vercel and redeploy." }, { status: 503 });
  }
  const key = clientKey(request);
  const now = Date.now();
  const entry = attempts.get(key);
  if (entry && now - entry.first < WINDOW_MS && entry.count >= MAX_ATTEMPTS) {
    return Response.json({ ok: false, error: "Too many attempts. Wait 15 minutes." }, { status: 429 });
  }

  const body = await request.json().catch(() => null) as { passcode?: string } | null;
  const passcode = typeof body?.passcode === "string" ? body.passcode : "";
  if (!(await passcodeMatches(passcode))) {
    const next = entry && now - entry.first < WINDOW_MS ? { count: entry.count + 1, first: entry.first } : { count: 1, first: now };
    attempts.set(key, next);
    return Response.json({ ok: false, error: "Wrong passcode." }, { status: 401 });
  }

  attempts.delete(key);
  const session = await createOwnerSession();
  if (!session) return Response.json({ ok: false, error: "Session could not be created." }, { status: 500 });
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Set-Cookie": `${OWNER_COOKIE}=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`,
    },
  });
}
