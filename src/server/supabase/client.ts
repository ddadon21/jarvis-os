import { createBrowserClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/env";

/**
 * Browser Supabase client.
 *
 * Uses the anon key, which is safe in the browser ONLY because row-level
 * security is enabled on every table and every policy is scoped to
 * `auth.uid()`. If RLS is ever disabled on a table, this key becomes a full
 * read of that table by anyone who opens devtools. See docs/SECURITY.md.
 */
export function createSupabaseBrowserClient() {
  const env = clientEnv();

  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, or run with JARVIS_DATA_SOURCE=dev.",
    );
  }

  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
