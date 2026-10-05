import { NextResponse, type NextRequest } from "next/server";
import {
  OWNER_COOKIE,
  OWNER_HEADER,
  automationSecrets,
  ownerAuthConfigured,
  ownerAuthRequired,
  verifyOwnerSession,
} from "./lib/owner-auth";

/**
 * Owner gate for every page and API route.
 *
 * Routes listed in SELF_AUTHENTICATED check their own device token, webhook
 * secret, or platform signature and are therefore allowed through here.
 * Everything else requires the owner session cookie or an automation secret.
 */

const SELF_AUTHENTICATED = [
  /^\/login$/,
  /^\/api\/auth\/(login|logout)$/,
  /^\/api\/trading\/observe-frame$/,
  /^\/api\/trading\/device\/control$/,
  /^\/api\/trading\/observer-events$/,
  /^\/api\/trading\/observer-frames$/,
  /^\/api\/trading\/pair\/start$/,
  /^\/api\/trading\/ingest$/,
  /^\/api\/trading\/market-webhook$/,
  /^\/api\/desktop\/result$/,
  /^\/api\/obsidian\/result$/,
  /^\/api\/vault\/(sync|pull)$/,
  /^\/api\/cron\//,
  /^\/\.well-known\/workflow\//,
  /^\/sentryops-landing-preview$/,
];

function isSelfAuthenticated(pathname: string) {
  return SELF_AUTHENTICATED.some((pattern) => pattern.test(pathname));
}

function forwardAsOwner(request: NextRequest, owner: boolean) {
  const headers = new Headers(request.headers);
  headers.delete(OWNER_HEADER);
  if (owner) headers.set(OWNER_HEADER, "1");
  const response = NextResponse.next({ request: { headers } });
  if (!ownerAuthConfigured()) response.headers.set("x-jarvis-auth", "disabled");
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isSelfAuthenticated(pathname)) return forwardAsOwner(request, false);

  if (!ownerAuthRequired()) {
    // Preview/dev without a passcode: Vercel Deployment Protection is the only gate.
    return forwardAsOwner(request, true);
  }

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (bearer && automationSecrets().includes(bearer)) return forwardAsOwner(request, true);

  if (await verifyOwnerSession(request.cookies.get(OWNER_COOKIE)?.value)) return forwardAsOwner(request, true);

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, error: ownerAuthConfigured() ? "Owner login required." : "Owner login is not configured (set JARVIS_OWNER_PASSCODE)." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "?next=" + encodeURIComponent(pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    // Everything except Next internals and static public assets.
    "/((?!_next/static|_next/image|favicon.ico|jarvis-icon-192.svg|jarvis-icon-512.svg|manifest.webmanifest|sw.js|sentryops-preview/).*)",
  ],
};
