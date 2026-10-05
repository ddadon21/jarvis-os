import { getCache } from "@vercel/functions";
import { durableConfigured, durableContext } from "./jarvis-db";
import { getLocalAgentPresence } from "./trading-device-link";

/**
 * Machine checks the IT agents run every cycle. Evidence lines start with
 * "check:" so QA can tell a measured result from an agent's claim.
 */
export type CheckResult = { ok: boolean; degraded: boolean; summary: string; findings: string[]; evidence: string[] };

const REQUIRED_TABLES = ["trading_trades", "trading_trade_events", "trading_bars", "jarvis_device_commands", "jarvis_runtime_events", "trading_model_versions"];

export async function infrastructureCheck(): Promise<CheckResult> {
  const findings: string[] = [];
  const evidence: string[] = [];
  // Runtime cache round trip.
  try {
    const key = "jarvis:check:cache";
    const value = Date.now();
    await getCache().set(key, value, { ttl: 120 });
    const read = await getCache().get(key);
    evidence.push(`check:runtime-cache=${read === value ? "ok" : "mismatch"}`);
    if (read !== value) findings.push("Runtime cache round trip did not return the written value.");
  } catch {
    evidence.push("check:runtime-cache=unavailable");
    findings.push("Runtime cache is unavailable in this environment.");
  }
  if (!durableConfigured()) {
    findings.push("Durable storage is not configured (SUPABASE_SERVICE_ROLE_KEY missing): trades and learning data are not saved permanently.");
    evidence.push("check:durable=not-configured");
  } else {
    const ctx = await durableContext();
    if (!ctx) {
      findings.push("Supabase reachable but the primary workspace was not found.");
      evidence.push("check:durable=no-workspace");
    } else {
      const missing: string[] = [];
      for (const table of REQUIRED_TABLES) {
        const { error } = await ctx.db.from(table).select("*", { head: true, count: "exact" }).eq("workspace_id", ctx.workspaceId).limit(1);
        if (error) missing.push(table);
      }
      evidence.push(`check:durable-tables=${REQUIRED_TABLES.length - missing.length}/${REQUIRED_TABLES.length}`);
      if (missing.length) findings.push(`Durable tables missing (apply supabase/migrations): ${missing.join(", ")}.`);
    }
  }
  const degraded = findings.length > 0;
  return {
    ok: !degraded,
    degraded,
    summary: degraded ? "Infrastructure check found: " + findings.join(" ") : "Infrastructure check passed: runtime cache round trip and all durable tables reachable.",
    findings,
    evidence,
  };
}

export function securityCheck(): CheckResult {
  const production = process.env.VERCEL_ENV === "production";
  const findings: string[] = [];
  const evidence: string[] = [];
  const has = (name: string, min = 1) => typeof process.env[name] === "string" && (process.env[name] as string).length >= min;
  const record = (name: string, ok: boolean, why: string, required: boolean) => {
    evidence.push(`check:${name}=${ok ? "set" : "missing"}`);
    if (!ok && required) findings.push(why);
  };
  record("owner-passcode", has("JARVIS_OWNER_PASSCODE", 8), "JARVIS_OWNER_PASSCODE is not set: owner login is off (production refuses access without it).", production || has("JARVIS_OWNER_PASSCODE"));
  record("cron-secret", has("CRON_SECRET", 16), "CRON_SECRET is missing: scheduled jobs are not authenticated in production.", production);
  record("service-role", has("SUPABASE_SERVICE_ROLE_KEY"), "SUPABASE_SERVICE_ROLE_KEY is missing: durable storage is off.", true);
  record("market-webhook-secret", has("JARVIS_MARKET_WEBHOOK_SECRET", 16), "JARVIS_MARKET_WEBHOOK_SECRET is missing or short: the TradingView bar feed cannot be accepted.", false);
  const degraded = findings.length > 0;
  return {
    ok: !degraded,
    degraded,
    summary: degraded ? "Security check found: " + findings.join(" ") : "Security check passed: owner login, cron authentication and durable storage credentials are configured.",
    findings,
    evidence,
  };
}

export async function integrationsCheck(): Promise<CheckResult> {
  const findings: string[] = [];
  const evidence: string[] = [];
  const presence = await getLocalAgentPresence().catch(() => null);
  evidence.push(`check:local-agent=${presence?.online ? "online" : "offline"}`, `check:local-agent-version=${presence?.observerVersion ?? "none"}`);
  if (!presence) findings.push("No Local Agent has connected yet: install and pair the Windows Observer.");
  else if (!presence.online) findings.push("Local Agent is paired but not sending heartbeats.");
  if (presence?.observerVersion && Number.parseInt(presence.observerVersion, 10) < 1) {
    findings.push(`Local Agent ${presence.observerVersion} predates the 1.0 trade journal; install the latest Observer build.`);
  }
  const ctx = await durableContext();
  if (!ctx) {
    evidence.push("check:market-data=unverifiable");
    findings.push("Market data and trade journal freshness cannot be checked until durable storage is configured.");
  } else {
    const latestBar = await ctx.db.from("trading_bars").select("ts").eq("workspace_id", ctx.workspaceId).order("ts", { ascending: false }).limit(1);
    const barAt = (latestBar.data?.[0] as { ts?: string } | undefined)?.ts ?? null;
    evidence.push(`check:last-bar=${barAt ?? "none"}`);
    const latestEvent = await ctx.db.from("trading_trade_events").select("at").eq("workspace_id", ctx.workspaceId).order("at", { ascending: false }).limit(1);
    evidence.push(`check:last-trade-event=${(latestEvent.data?.[0] as { at?: string } | undefined)?.at ?? "none"}`);
    if (!barAt) findings.push("No market bars received yet: add the TradingView bar feed alert or import CSV history.");
    else if (Date.now() - Date.parse(barAt) > 4 * 86_400_000) findings.push("Market bar feed has been silent for more than 4 days.");
  }
  const degraded = findings.length > 0;
  return {
    ok: !degraded,
    degraded,
    summary: degraded ? "Integration check found: " + findings.join(" ") : "Integration check passed: Local Agent online and market data arriving.",
    findings,
    evidence,
  };
}
