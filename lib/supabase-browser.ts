import { createClient, SupabaseClient } from "@supabase/supabase-js";

const fallbackUrl = "https://cubkgxdhkehmzczbvczy.supabase.co";
const fallbackPublishableKey = "sb_publishable_90f_kCgqpgfC8NvoviAyXg_anParHd2";

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient() {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || fallbackUrl;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || fallbackPublishableKey;

  browserClient = createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return browserClient;
}
