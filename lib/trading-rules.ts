import { durableRead, durableWrite } from "./jarvis-db";

/** Dwight's trading rules, stored in jarvis_settings (scope TRADING, key "rules"). */
export type TradingRules = {
  propFirm: string;
  accountLabel: string;
  maxTradesPerDay: number;
  riskTargetDollars: number;
  /** Optional per-root overrides of dollars per point, e.g. { "MNQ": 2 }. */
  pointValues: Record<string, number>;
};

export const DEFAULT_TRADING_RULES: TradingRules = {
  propFirm: "Lucid Trading",
  accountLabel: "CURRENT PROP ACCOUNT",
  maxTradesPerDay: 2,
  riskTargetDollars: 500,
  pointValues: {},
};

const CACHE_MS = 60_000;
let cached: { rules: TradingRules; at: number } | null = null;

export function normalizeTradingRules(input: unknown): TradingRules {
  const value = input && typeof input === "object" ? (input as Partial<TradingRules>) : {};
  const positive = (n: unknown, fallback: number, max: number) =>
    typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.min(max, n) : fallback;
  const pointValues: Record<string, number> = {};
  if (value.pointValues && typeof value.pointValues === "object") {
    for (const [key, raw] of Object.entries(value.pointValues)) {
      if (/^[A-Z0-9]{1,6}$/i.test(key) && typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
        pointValues[key.toUpperCase()] = raw;
      }
    }
  }
  return {
    propFirm: typeof value.propFirm === "string" && value.propFirm.trim() ? value.propFirm.trim().slice(0, 80) : DEFAULT_TRADING_RULES.propFirm,
    accountLabel: typeof value.accountLabel === "string" && value.accountLabel.trim() ? value.accountLabel.trim().slice(0, 80) : DEFAULT_TRADING_RULES.accountLabel,
    maxTradesPerDay: Math.round(positive(value.maxTradesPerDay, DEFAULT_TRADING_RULES.maxTradesPerDay, 50)),
    riskTargetDollars: positive(value.riskTargetDollars, DEFAULT_TRADING_RULES.riskTargetDollars, 1_000_000),
    pointValues,
  };
}

export async function getTradingRules(): Promise<TradingRules> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.rules;
  const row = await durableRead<{ value: unknown } | null>("jarvis_settings", ({ db, workspaceId }) =>
    db.from("jarvis_settings").select("value").eq("workspace_id", workspaceId).eq("scope", "TRADING").eq("key", "rules").maybeSingle(),
  );
  const rules = normalizeTradingRules(row?.value);
  cached = { rules, at: Date.now() };
  return rules;
}

/** Synchronous accessor for hot paths; returns the last loaded rules or defaults. */
export function cachedTradingRules(): TradingRules {
  return cached?.rules ?? DEFAULT_TRADING_RULES;
}

export async function saveTradingRules(input: unknown): Promise<TradingRules> {
  const rules = normalizeTradingRules(input);
  await durableWrite("jarvis_settings", ({ db, workspaceId }) =>
    db.from("jarvis_settings").upsert(
      { workspace_id: workspaceId, scope: "TRADING", key: "rules", value: rules },
      { onConflict: "workspace_id,scope,key" },
    ),
  );
  cached = { rules, at: Date.now() };
  return rules;
}
