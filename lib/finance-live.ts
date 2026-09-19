import {
  FinanceAccountState,
  FinanceGoalState,
  FinanceLiabilityState,
  FinanceRuntimeState,
  appendRuntimeEvent,
  createRuntimeEvent,
  getFinanceState,
  setFinanceState,
} from "./jarvis-runtime";

const FIRST_CAPITAL_MILESTONE = 5_000;
const HUNDRED_MILLION = 100_000_000;

const SEEDED_ACCOUNTS: FinanceAccountState[] = [
  { key: "chase-checking", institution: "CHASE", name: "CHASE SECURE BANKING", type: "depository", subtype: "checking", ownership: "PERSONAL", role: "PERSONAL CONTROL", current: 14.52, available: 6.25, limit: null },
  { key: "bofa-personal", institution: "BANK OF AMERICA", name: "FINANCIAL OPS", type: "depository", subtype: "checking", ownership: "PERSONAL", role: "CONTROLLED BILLS", current: 1.64, available: 1.64, limit: null },
  { key: "bofa-business", institution: "BANK OF AMERICA", name: "BUSINESS ADV FUNDAMENTALS", type: "depository", subtype: "checking", ownership: "BUSINESS", role: "CAPITAL GENERATION", current: 661.50, available: 596.54, limit: null },
  { key: "schwab-checking", institution: "CHARLES SCHWAB", name: "INVESTOR CHECKING", type: "depository", subtype: "checking", ownership: "PERSONAL", role: "INVESTMENT ROUTING", current: 0.93, available: 0.93, limit: null },
  { key: "schwab-brokerage", institution: "CHARLES SCHWAB", name: "INDIVIDUAL", type: "investment", subtype: "brokerage", ownership: "PERSONAL", role: "COMPOUNDING", current: 1.78, available: 1.78, limit: null },
  { key: "amex-hysa", institution: "AMERICAN EXPRESS", name: "HIGH YIELD SAVINGS ACCOUNT", type: "depository", subtype: "savings", ownership: "PERSONAL", role: "LIQUIDITY / RESERVE", current: 0.74, available: 0.74, limit: null },
  { key: "rbfcu-checking", institution: "RBFCU", name: "CHECKING", type: "depository", subtype: "checking", ownership: "PERSONAL", role: "CASH", current: 0.05, available: 0.05, limit: null },
  { key: "rbfcu-savings", institution: "RBFCU", name: "PRIMARY SAVINGS", type: "depository", subtype: "savings", ownership: "PERSONAL", role: "CASH", current: 3.99, available: 2.99, limit: null },
  { key: "rbfcu-platinum", institution: "RBFCU", name: "PLATINUM PREMIER", type: "credit", subtype: "credit card", ownership: "AUTHORIZED_USER", role: "CREDIT CONTEXT", current: 8205.97, available: 4294.0, limit: 12500.0 },
  { key: "rbfcu-world", institution: "RBFCU", name: "WORLD CARD", type: "credit", subtype: "credit card", ownership: "PERSONAL", role: "LIABILITY", current: 598.12, available: 1.0, limit: 600.0 },
  { key: "capitalone-quicksilver", institution: "CAPITAL ONE", name: "QUICKSILVER", type: "credit", subtype: "credit card", ownership: "PERSONAL", role: "LIABILITY", current: 528.05, available: null, limit: null },
];

const SEEDED_LIABILITIES: FinanceLiabilityState[] = [
  { accountKey: "rbfcu-world", apr: 18, minimum: 25, due: "2026-09-21" },
  { accountKey: "capitalone-quicksilver", apr: null, minimum: 25, due: "2026-09-14" },
  { accountKey: "rbfcu-platinum", apr: 11.2, minimum: 0, due: "2026-10-04" },
];

export function getNextNetWorthMilestone(netWorth: number) {
  const step = netWorth < 100_000 ? 5_000 : 10_000;
  const nonNegative = Math.max(netWorth, 0);
  const floor = Math.floor(nonNegative / step) * step;
  const target = floor + step;
  const progress = netWorth <= floor ? 0 : Math.min(100, ((netWorth - floor) / step) * 100);
  return { floor, target, step, progress };
}

export function buildFinanceState(input: {
  accounts: FinanceAccountState[];
  liabilities?: FinanceLiabilityState[];
  mode: FinanceRuntimeState["mode"];
  source: string;
  asOf?: string;
  connectionCount?: number;
  transactionHistory?: string;
  recurringHistory?: string;
  note?: string;
}): FinanceRuntimeState {
  const liabilities = input.liabilities ?? [];
  const accounts = input.accounts.map(sanitizeAccount);
  const liquidity = roundMoney(accounts.filter((account) => account.type === "depository").reduce((sum, account) => sum + Math.max(0, account.current), 0));
  const investmentValue = roundMoney(accounts.filter((account) => account.type === "investment").reduce((sum, account) => sum + account.current, 0));
  const personalDebt = roundMoney(accounts.filter((account) => (account.type === "credit" || account.type === "loan") && account.ownership !== "AUTHORIZED_USER").reduce((sum, account) => sum + Math.max(0, account.current), 0));
  const authorizedUserBalance = roundMoney(accounts.filter((account) => (account.type === "credit" || account.type === "loan") && account.ownership === "AUTHORIZED_USER").reduce((sum, account) => sum + Math.max(0, account.current), 0));
  const providerNetWorth = roundMoney(liquidity + investmentValue - personalDebt - authorizedUserBalance);
  const personalNetWorth = roundMoney(liquidity + investmentValue - personalDebt);
  const { currentStage, nextStage } = determineStage({ personalDebt, liquidity, personalNetWorth });

  return {
    version: 1,
    mode: input.mode,
    source: input.source.trim().slice(0, 80),
    asOf: normalizeDate(input.asOf),
    connectionCount: Math.max(0, Math.round(input.connectionCount ?? 0)),
    accountCount: accounts.length,
    transactionHistory: input.transactionHistory?.trim().slice(0, 80) || "UNKNOWN",
    recurringHistory: input.recurringHistory?.trim().slice(0, 80) || "UNKNOWN",
    accounts,
    liabilities,
    metrics: { personalNetWorth, providerNetWorth, liquidity, investmentValue, personalDebt, authorizedUserBalance },
    currentStage,
    nextStage,
    goals: buildGoals({ personalDebt, liquidity, personalNetWorth }),
    note: input.note?.trim().slice(0, 500) || (input.mode === "DIRECT"
      ? "Direct finance state is feeding Jarvis automatically."
      : "Connected finance data has been synchronized into Jarvis, but the website is not yet independently refreshing the provider connection."),
  };
}

export async function getOrSeedFinanceState(): Promise<FinanceRuntimeState> {
  const existing = await getFinanceState();
  if (existing) {
    const refreshed = buildFinanceState({
      accounts: existing.accounts,
      liabilities: existing.liabilities,
      mode: existing.mode,
      source: existing.source,
      asOf: existing.asOf,
      connectionCount: existing.connectionCount,
      transactionHistory: existing.transactionHistory,
      recurringHistory: existing.recurringHistory,
      note: existing.note,
    });
    await setFinanceState(refreshed);
    return refreshed;
  }

  const seeded = buildFinanceState({
    accounts: SEEDED_ACCOUNTS,
    liabilities: SEEDED_LIABILITIES,
    mode: "SYNCED_SNAPSHOT",
    source: "CHATGPT FINANCES",
    asOf: "2026-09-19T19:25:00.000Z",
    connectionCount: 7,
    transactionHistory: "FULL HISTORY READY",
    recurringHistory: "FULL HISTORY READY",
    note: "Connected-account snapshot synchronized from ChatGPT Finances on Sep 19, 2026. Jarvis is still in Phase 1 snapshot mode until direct provider refresh is connected.",
  });
  await setFinanceState(seeded);
  return seeded;
}

export async function ingestFinanceState(input: Parameters<typeof buildFinanceState>[0]): Promise<FinanceRuntimeState> {
  const previous = await getFinanceState();
  const next = buildFinanceState(input);
  await setFinanceState(next);
  if (!previous || financeFingerprint(previous) !== financeFingerprint(next)) {
    await appendRuntimeEvent(createRuntimeEvent({
      type: "finance.state_updated",
      domain: "FINANCE",
      source: next.mode === "DIRECT" ? "jarvis.finance.direct" : "jarvis.finance.snapshot",
      importance: "NORMAL",
      summary: `Finance refreshed: ${money(next.metrics.liquidity)} cash, ${money(next.metrics.personalDebt)} personal debt, ${signedMoney(next.metrics.personalNetWorth)} adjusted net worth.`,
    }));
  }
  return next;
}

export function financeDirective(state: FinanceRuntimeState): string {
  if (state.metrics.personalDebt > 0) {
    return `Protect operating cash and eliminate ${money(state.metrics.personalDebt)} of personal revolving debt. Credit repair comes before lifestyle expansion.`;
  }
  const milestone = getNextNetWorthMilestone(state.metrics.personalNetWorth);
  if (state.metrics.personalNetWorth < FIRST_CAPITAL_MILESTONE) {
    return `Debt is controlled. Push adjusted net worth toward the first ${money(FIRST_CAPITAL_MILESTONE)} capital milestone while building cash reserves.`;
  }
  return `Advance the next ${money(milestone.target)} net-worth milestone while increasing reliable cash flow, credit strength, productive assets, and long-term cash toward $100M.`;
}

function buildGoals(input: { personalDebt: number; liquidity: number; personalNetWorth: number }): FinanceGoalState[] {
  const milestone = getNextNetWorthMilestone(input.personalNetWorth);
  const hundredMCashProgress = clampPercent((Math.max(0, input.liquidity) / HUNDRED_MILLION) * 100);

  return [
    {
      name: "DEBT FREEDOM",
      state: input.personalDebt <= 0 ? "GREEN" : "RED",
      progress: input.personalDebt <= 0 ? 100 : null,
      current: input.personalDebt <= 0 ? "$0 personal debt" : `${money(input.personalDebt)} personal debt`,
      target: "$0",
      blocker: input.personalDebt <= 0 ? "Complete." : "Clear personal revolving balances while protecting enough cash to avoid recreating debt.",
    },
    {
      name: "NEXT WEALTH MILESTONE",
      state: milestone.progress >= 100 ? "GREEN" : milestone.progress >= 50 ? "YELLOW" : "RED",
      progress: milestone.progress,
      current: signedMoney(input.personalNetWorth),
      target: money(milestone.target),
      blocker: input.personalNetWorth < 0
        ? "Progress stays at 0% until adjusted net worth is positive."
        : `Target advances by ${money(milestone.step)} when reached; after $100,000 it advances by $10,000.`,
    },
    {
      name: "MOVE OUT",
      state: "SETUP",
      progress: null,
      current: "Criteria not locked",
      target: "Readiness gate",
      blocker: "Housing budget, move-in capital, cash floor and income-consistency gates still need to be locked.",
    },
    {
      name: "GR SUPRA",
      state: "SETUP",
      progress: null,
      current: "Criteria not locked",
      target: "Readiness gate",
      blocker: "Purchase price, down payment, insurance and post-purchase cash floor still need to be locked.",
    },
    {
      name: "$100M CASH",
      state: input.liquidity >= HUNDRED_MILLION ? "GREEN" : "RED",
      progress: hundredMCashProgress,
      current: money(input.liquidity),
      target: "$100,000,000",
      blocker: "Ultimate capital destination. Jarvis should compound through smaller stages instead of skipping financial foundations.",
    },
  ];
}

function determineStage(input: { personalDebt: number; liquidity: number; personalNetWorth: number }) {
  if (input.personalDebt > 0) return { currentStage: "DEBT", nextStage: "STABILITY" };
  if (input.liquidity < 2_500) return { currentStage: "STABILITY", nextStage: "RESERVES" };
  if (input.personalNetWorth < FIRST_CAPITAL_MILESTONE) return { currentStage: "RESERVES", nextStage: "CREDIT" };
  return { currentStage: "CAPITAL", nextStage: "INVESTING" };
}

function sanitizeAccount(account: FinanceAccountState): FinanceAccountState {
  return {
    ...account,
    key: account.key.trim().slice(0, 120),
    institution: account.institution.trim().slice(0, 80),
    name: account.name.trim().slice(0, 120),
    role: account.role.trim().slice(0, 80),
    current: safeNumber(account.current),
    available: account.available == null ? null : safeNumber(account.available),
    limit: account.limit == null ? null : safeNumber(account.limit),
  };
}

function financeFingerprint(state: FinanceRuntimeState) {
  return JSON.stringify({ mode: state.mode, asOf: state.asOf, metrics: state.metrics, accounts: state.accounts.map((a) => [a.key, a.current, a.available, a.limit]) });
}

function normalizeDate(value?: string) {
  if (value && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return new Date().toISOString();
}

function safeNumber(value: number) { return Number.isFinite(value) ? value : 0; }
function roundMoney(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }
function clampPercent(value: number) { return Math.max(0, Math.min(100, value)); }
function money(value: number) { return `$${Math.max(0, value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function signedMoney(value: number) { return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
