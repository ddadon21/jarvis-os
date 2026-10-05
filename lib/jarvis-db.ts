import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side durable storage for JARVIS.
 *
 * Runtime Cache is a fast, evictable copy. Supabase is the system of record.
 * Every helper here degrades to "not configured" instead of throwing so a
 * missing key or an unapplied migration never takes down live observation.
 */

const SUPABASE_FALLBACK_URL = "https://cubkgxdhkehmzczbvczy.supabase.co";
const WORKSPACE_TTL_MS = 10 * 60_000;

let client: SupabaseClient | null | undefined;
let workspaceCache: { id: string; at: number } | null = null;
const warned = new Set<string>();

export function durableDb(): SupabaseClient | null {
  if (client !== undefined) return client;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRole) {
    client = null;
    return client;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || SUPABASE_FALLBACK_URL;
  client = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export function durableConfigured() {
  return durableDb() !== null;
}

export async function primaryWorkspaceId(): Promise<string | null> {
  const db = durableDb();
  if (!db) return null;
  if (workspaceCache && Date.now() - workspaceCache.at < WORKSPACE_TTL_MS) return workspaceCache.id;
  try {
    const { data, error } = await db.from("jarvis_workspaces").select("id").eq("slug", "primary").maybeSingle();
    if (error || !data?.id) {
      warnOnce("workspace", error?.message ?? "primary workspace not found");
      return null;
    }
    workspaceCache = { id: String(data.id), at: Date.now() };
    return workspaceCache.id;
  } catch (error) {
    warnOnce("workspace", error instanceof Error ? error.message : "lookup failed");
    return null;
  }
}

/** Resolves db + workspace, or null when durable storage is unavailable. */
export async function durableContext(): Promise<{ db: SupabaseClient; workspaceId: string } | null> {
  const db = durableDb();
  if (!db) return null;
  const workspaceId = await primaryWorkspaceId();
  if (!workspaceId) return null;
  return { db, workspaceId };
}

/**
 * Runs a durable write and swallows failures after logging once per table.
 * Returns true only when Supabase acknowledged the write.
 */
export async function durableWrite(
  table: string,
  run: (ctx: { db: SupabaseClient; workspaceId: string }) => PromiseLike<{ error: { message: string; code?: string } | null }>,
): Promise<boolean> {
  const ctx = await durableContext();
  if (!ctx) return false;
  try {
    const { error } = await run(ctx);
    if (error) {
      warnOnce(table, error.code === "42P01"
        ? `table ${table} is missing; apply supabase/migrations`
        : error.message);
      return false;
    }
    return true;
  } catch (error) {
    warnOnce(table, error instanceof Error ? error.message : "write failed");
    return false;
  }
}

export async function durableRead<T>(
  table: string,
  run: (ctx: { db: SupabaseClient; workspaceId: string }) => PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>,
): Promise<T | null> {
  const ctx = await durableContext();
  if (!ctx) return null;
  try {
    const { data, error } = await run(ctx);
    if (error) {
      warnOnce(table + ":read", error.message);
      return null;
    }
    return data;
  } catch (error) {
    warnOnce(table + ":read", error instanceof Error ? error.message : "read failed");
    return null;
  }
}

function warnOnce(key: string, message: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[jarvis-db] ${key}: ${message}`);
}

/** Test hook: forget memoized client/workspace. */
export function resetDurableDbForTests() {
  client = undefined;
  workspaceCache = null;
  warned.clear();
}
