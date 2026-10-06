import { getLifetimeEarned } from "../../../../lib/company-earnings-store";

export const runtime = "nodejs";

/** LIFETIME EARNED read-model (owner-only via middleware). */
export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("refresh") === "1";
  const earned = await getLifetimeEarned(force);
  return Response.json({ ok: true, earned }, { headers: { "Cache-Control": "no-store" } });
}
