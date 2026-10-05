/**
 * Owner session for JARVIS (edge + node compatible, Web Crypto only).
 *
 * One owner, one passcode (JARVIS_OWNER_PASSCODE). A successful login sets an
 * HttpOnly cookie holding an HMAC-signed expiry. Middleware verifies it on
 * every page and API request except the device/cron/webhook routes that carry
 * their own secrets.
 */

export const OWNER_COOKIE = "jarvis_owner";
export const OWNER_HEADER = "x-jarvis-owner";
export const SESSION_DAYS = 30;

const encoder = new TextEncoder();

function sessionSecret(): string | null {
  const explicit = process.env.JARVIS_SESSION_SECRET;
  if (explicit && explicit.length >= 16) return explicit;
  const passcode = process.env.JARVIS_OWNER_PASSCODE;
  return passcode ? "jarvis-owner-session::" + passcode : null;
}

export function ownerAuthConfigured() {
  return Boolean(process.env.JARVIS_OWNER_PASSCODE);
}

/** Production must never run without an owner login. Preview/dev may (Vercel protection still applies). */
export function ownerAuthRequired() {
  return ownerAuthConfigured() || process.env.VERCEL_ENV === "production";
}

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createOwnerSession(now = Date.now()) {
  const secret = sessionSecret();
  if (!secret) return null;
  const expires = now + SESSION_DAYS * 86_400_000;
  const payload = `v1.${expires}`;
  return `${payload}.${await hmac(payload, secret)}`;
}

export async function verifyOwnerSession(value: string | null | undefined, now = Date.now()) {
  const secret = sessionSecret();
  if (!secret || !value) return false;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const expires = Number(parts[1]);
  if (!Number.isFinite(expires) || expires < now) return false;
  return safeEqual(parts[2], await hmac(`${parts[0]}.${parts[1]}`, secret));
}

export async function passcodeMatches(candidate: string) {
  const passcode = process.env.JARVIS_OWNER_PASSCODE;
  if (!passcode || !candidate) return false;
  // Compare digests so timing does not depend on where the strings differ.
  const salt = "jarvis-passcode-compare";
  return safeEqual(await hmac(candidate, salt), await hmac(passcode, salt));
}

/** Server secrets that automation may present instead of an owner session. */
export function automationSecrets(): string[] {
  return [
    process.env.CRON_SECRET,
    process.env.JARVIS_WORKFORCE_SECRET,
    process.env.JARVIS_OBJECTIVE_SECRET,
    process.env.JARVIS_EVENT_SECRET,
    process.env.JARVIS_TRADING_SECRET,
    process.env.JARVIS_FINANCE_SECRET,
  ].filter((value): value is string => typeof value === "string" && value.length >= 16);
}

/** True when middleware verified the owner (or automation secret) for this request. */
export function requestIsOwner(request: Request) {
  return request.headers.get(OWNER_HEADER) === "1";
}

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set.
 * The x-vercel-cron-schedule header alone is spoofable, so it is only trusted outside production.
 */
export function cronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (secret) return authorization === `Bearer ${secret}`;
  if (process.env.VERCEL_ENV === "production") return false;
  if (request.headers.get("x-vercel-cron-schedule")) return true;
  return new URL(request.url).searchParams.get("manual") === "1";
}
