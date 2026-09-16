import { FinanceAccountState, FinanceLiabilityState, FinanceRuntimeState } from "./jarvis-runtime";
import { ingestFinanceState } from "./finance-live";

type PlaidAccount = {
  account_id: string;
  name?: string | null;
  official_name?: string | null;
  type?: string | null;
  subtype?: string | null;
  balances?: {
    available?: number | null;
    current?: number | null;
    limit?: number | null;
  } | null;
};

type PlaidCreditLiability = {
  account_id?: string | null;
  minimum_payment_amount?: number | null;
  next_payment_due_date?: string | null;
  aprs?: Array<{ apr_percentage?: number | null }> | null;
};

type PlaidTokenMap = Record<string, string>;

export type PlaidRefreshResult = {
  configured: boolean;
  refreshed: boolean;
  realtime: boolean;
  state: FinanceRuntimeState | null;
  error?: string;
};

export function plaidFinanceConfigured() {
  return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET && parseAccessTokens());
}

export async function refreshFinanceFromPlaid(): Promise<PlaidRefreshResult> {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const accessTokens = parseAccessTokens();
  const realtime = (process.env.PLAID_BALANCE_MODE || "cached").toLowerCase() === "realtime";

  if (!clientId || !secret || !accessTokens) {
    return { configured: false, refreshed: false, realtime, state: null };
  }

  try {
    const endpoint = realtime ? "/accounts/balance/get" : "/accounts/get";
    const entries = Object.entries(accessTokens);
    const responses = await Promise.all(
      entries.map(async ([institutionLabel, accessToken]) => {
        const accountsResponse = await plaidPost<{ accounts?: PlaidAccount[] }>(endpoint, {
          client_id: clientId,
          secret,
          access_token: accessToken,
        });

        let creditLiabilities: PlaidCreditLiability[] = [];
        if ((accountsResponse.accounts ?? []).some((account) => account.type === "credit" || account.type === "loan")) {
          try {
            const liabilityResponse = await plaidPost<{
              liabilities?: { credit?: PlaidCreditLiability[] | null } | null;
            }>("/liabilities/get", {
              client_id: clientId,
              secret,
              access_token: accessToken,
            });
            creditLiabilities = liabilityResponse.liabilities?.credit ?? [];
          } catch {
            // Liabilities may not be enabled for every Item. Balances can still refresh safely.
          }
        }

        return {
          institutionLabel,
          accounts: accountsResponse.accounts ?? [],
          creditLiabilities,
        };
      }),
    );

    const accounts: FinanceAccountState[] = [];
    const liabilities: FinanceLiabilityState[] = [];
    let runningIndex = 0;

    for (const response of responses) {
      const providerIdToKey = new Map<string, string>();

      for (const account of response.accounts) {
        const type = normalizeAccountType(account.type);
        if (!type) continue;

        const name = (account.official_name || account.name || "ACCOUNT").trim();
        const key = `${slug(response.institutionLabel)}-${slug(name)}-${runningIndex++}`;
        providerIdToKey.set(account.account_id, key);

        const ownership = inferOwnership(response.institutionLabel, name);
        accounts.push({
          key,
          institution: response.institutionLabel.toUpperCase().slice(0, 80),
          name: name.toUpperCase().slice(0, 120),
          type,
          subtype: account.subtype ?? null,
          ownership,
          role: inferRole(response.institutionLabel, name, type, ownership),
          current: numberOrZero(account.balances?.current),
          available: numberOrNull(account.balances?.available),
          limit: numberOrNull(account.balances?.limit),
        });
      }

      for (const liability of response.creditLiabilities) {
        if (!liability.account_id) continue;
        const accountKey = providerIdToKey.get(liability.account_id);
        if (!accountKey) continue;
        const apr = liability.aprs?.find((item) => typeof item.apr_percentage === "number")?.apr_percentage ?? null;
        liabilities.push({
          accountKey,
          apr,
          minimum: numberOrNull(liability.minimum_payment_amount),
          due: liability.next_payment_due_date ?? null,
        });
      }
    }

    if (accounts.length === 0) {
      return { configured: true, refreshed: false, realtime, state: null, error: "No accounts were returned by the direct provider." };
    }

    const state = await ingestFinanceState({
      accounts,
      liabilities,
      mode: "DIRECT",
      source: realtime ? "PLAID DIRECT · REALTIME BALANCE" : "PLAID DIRECT · AUTOMATIC REFRESH",
      asOf: new Date().toISOString(),
      connectionCount: entries.length,
      transactionHistory: "DIRECT PROVIDER",
      recurringHistory: "DIRECT PROVIDER",
      note: realtime
        ? "Jarvis is refreshing balances directly from the financial provider. Real-time balance calls may carry provider usage cost."
        : "Jarvis is refreshing account state directly from the financial provider using its normal cached account updates. Set PLAID_BALANCE_MODE=realtime only when real-time balance calls are worth the additional provider usage cost.",
    });

    return { configured: true, refreshed: true, realtime, state };
  } catch (error) {
    console.error("Direct finance refresh failed", error);
    return {
      configured: true,
      refreshed: false,
      realtime,
      state: null,
      error: error instanceof Error ? error.message.slice(0, 240) : "Direct finance refresh failed.",
    };
  }
}

async function plaidPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${plaidBaseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const data = (await response.json().catch(() => ({}))) as T & { error_message?: string; error_code?: string };
  if (!response.ok) {
    throw new Error(data.error_message || data.error_code || `Plaid request failed with ${response.status}.`);
  }
  return data;
}

function plaidBaseUrl() {
  const env = (process.env.PLAID_ENV || "production").toLowerCase();
  if (env === "sandbox") return "https://sandbox.plaid.com";
  if (env === "development") return "https://development.plaid.com";
  return "https://production.plaid.com";
}

function parseAccessTokens(): PlaidTokenMap | null {
  const raw = process.env.PLAID_ACCESS_TOKENS;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const valid = Object.entries(parsed as Record<string, unknown>).filter(
      ([label, token]) => label.trim() && typeof token === "string" && token.trim(),
    );
    return valid.length > 0 ? Object.fromEntries(valid) as PlaidTokenMap : null;
  } catch {
    return null;
  }
}

function normalizeAccountType(value: string | null | undefined): FinanceAccountState["type"] | null {
  if (value === "depository" || value === "investment" || value === "credit" || value === "loan") return value;
  return null;
}

function inferOwnership(institution: string, name: string): FinanceAccountState["ownership"] {
  const combined = `${institution} ${name}`.toUpperCase();
  if (combined.includes("PLATINUM PREMIER")) return "AUTHORIZED_USER";
  if (combined.includes("BUSINESS")) return "BUSINESS";
  return "PERSONAL";
}

function inferRole(
  institution: string,
  name: string,
  type: FinanceAccountState["type"],
  ownership: FinanceAccountState["ownership"],
) {
  const combined = `${institution} ${name}`.toUpperCase();
  if (ownership === "AUTHORIZED_USER") return "CREDIT CONTEXT";
  if (ownership === "BUSINESS") return "CAPITAL GENERATION";
  if (type === "credit" || type === "loan") return "LIABILITY";
  if (type === "investment") return "COMPOUNDING";
  if (combined.includes("HIGH YIELD") || combined.includes("SAVINGS")) return "LIQUIDITY / RESERVE";
  if (combined.includes("SCHWAB") || combined.includes("INVEST")) return "INVESTMENT ROUTING";
  if (combined.includes("FINANCIAL OPS")) return "CONTROLLED BILLS";
  return "PERSONAL CONTROL";
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "account";
}

function numberOrZero(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function numberOrNull(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
