import type { DomainContext } from "@/core/domain-module";
import { serverEnv } from "@/lib/env";
import { DEV_USER_ID } from "@/dev/notice";

/**
 * Resolves the acting user for a server render.
 *
 * v0.1 has no authentication: in dev mode this returns a fixed development
 * user id. When Supabase Auth lands, this function reads the session and
 * everything above it keeps working unchanged — which is the reason it exists
 * as a seam now rather than `DEV_USER_ID` being referenced across the app.
 */
export async function requireUserId(): Promise<string> {
  const env = serverEnv();

  if (env.JARVIS_DATA_SOURCE === "dev") return DEV_USER_ID;

  throw new Error("Authentication is not implemented yet. Run with JARVIS_DATA_SOURCE=dev.");
}

/** Standard context passed to every domain module. */
export async function buildDomainContext(): Promise<DomainContext> {
  return {
    userId: await requireUserId(),
    now: new Date(),
    // Autonomy is per-capability; this is the default posture for modules that
    // only ask "how far may I go?" in the abstract. Real checks go through
    // src/core/permissions/policy.ts.
    actionLevel: "recommend",
  };
}
