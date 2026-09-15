import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { serverEnv } from "@/lib/env";

/**
 * Server Supabase client, scoped to the signed-in user.
 *
 * This is the default for all server-side reads and writes. It carries the
 * user's session, so row-level security does the authorisation work — the
 * application does not have to remember to filter by `user_id` on every query,
 * and a forgotten filter cannot leak another user's data.
 */
export async function createSupabaseServerClient() {
  const env = serverEnv();

  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error("Supabase is not configured. See .env.example.");
  }

  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. Session refresh is handled by
          // middleware; swallowing here is the documented Supabase SSR pattern.
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses row-level security entirely.
 *
 * Use only for background work with no user session — scheduled ingestion,
 * migrations, system maintenance. Never to serve a user request: if a request
 * needs data the user-scoped client cannot see, that is an RLS policy problem,
 * not a reason to escalate. Every call site must be reviewable on sight, which
 * is why this throws rather than falling back.
 */
export function createSupabaseServiceClient() {
  const env = serverEnv();

  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Service-role Supabase access requires SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    cookies: {
      getAll: () => [],
      setAll: () => undefined,
    },
  });
}
