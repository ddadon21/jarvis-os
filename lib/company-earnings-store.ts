import { durableContext } from "./jarvis-db";
import { FUTURE_EARNED_SOURCES, payoutRowToRecord, summarizeLifetimeEarned, type EarnedSourceState, type LifetimeEarned } from "./company-earnings";

let cached: { at: number; value: LifetimeEarned } | null = null;
const CACHE_MS = 60_000;

/** Reads every connected revenue source and returns the Lifetime Earned read-model. */
export async function getLifetimeEarned(force = false): Promise<LifetimeEarned> {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const payouts: EarnedSourceState = { source: "TRADING_PAYOUTS", label: "Prop-firm trading payouts", status: "UNAVAILABLE", priority: 10, records: [] };
  const ctx = await durableContext();
  if (!ctx) {
    payouts.note = "Supabase is not configured on the server.";
  } else {
    const { data, error } = await ctx.db.from("trading_payouts").select("*").eq("workspace_id", ctx.workspaceId).limit(2000);
    if (error) {
      payouts.note = "Could not read public.trading_payouts: " + error.message.slice(0, 160);
    } else {
      payouts.status = "CONNECTED";
      payouts.records = (data ?? []).map((row) => payoutRowToRecord(row as Record<string, unknown>)).filter((record) => record !== null);
    }
  }

  const value = summarizeLifetimeEarned([payouts, ...FUTURE_EARNED_SOURCES]);
  // Never cache a failed read for long: the next poll should retry.
  cached = { at: value.coverage === "UNAVAILABLE" ? Date.now() - CACHE_MS + 5_000 : Date.now(), value };
  return value;
}
