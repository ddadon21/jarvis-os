import { durableConfigured, durableContext } from "../../../../lib/jarvis-db";

export const runtime = "nodejs";

const TABLES = [
  "jarvis_runtime_events",
  "trading_trades",
  "trading_trade_events",
  "trading_observer_snapshots",
  "trading_bars",
  "trading_model_versions",
  "trading_signals",
  "jarvis_devices",
  "jarvis_device_commands",
  "jarvis_approvals",
  "jarvis_memory_facts",
  "jarvis_vault_notes",
];

/** Verifies the durable-core migration is applied and reachable. */
export async function GET() {
  if (!durableConfigured()) {
    return Response.json({
      ok: false,
      configured: false,
      fix: "Set SUPABASE_SERVICE_ROLE_KEY in Vercel project environment variables, then redeploy.",
    });
  }
  const ctx = await durableContext();
  if (!ctx) {
    return Response.json({ ok: false, configured: true, fix: "The primary workspace (jarvis_workspaces.slug = 'primary') was not found." });
  }
  const checks = await Promise.all(TABLES.map(async (table) => {
    const { error, count } = await ctx.db.from(table).select("*", { count: "exact", head: true }).eq("workspace_id", ctx.workspaceId);
    return { table, ok: !error, rows: error ? null : count ?? 0, error: error?.message ?? null };
  }));
  const missing = checks.filter((check) => !check.ok);
  return Response.json({
    ok: missing.length === 0,
    configured: true,
    tables: checks,
    fix: missing.length ? "Run supabase/migrations/20261005000000_jarvis_durable_core.sql in the Supabase SQL editor." : null,
  }, { headers: { "Cache-Control": "no-store" } });
}
