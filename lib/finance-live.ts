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

const TEN_K = 10_000;
const ONE_MILLION = 1_000_000;

const SEEDED_ACCOUNTS: FinanceAccountState[] = [
  { key: "chase-checking", institution: "CHASE", name: "CHASE SECURE BANKING", type: "depository", subtype: "checking", ownership: "PERSONAL", role: "PERSONAL CONTROL", current: 60.27, available: 11.25, limit: null },
  { key: "bofa-personal", institution: "BANK OF AMERICA", name: "FINANCIAL OPS", type: "depository", subtype: "checking", ownership: "PERSONAL", role: "CONTROLLED BILLS", current: 5.63, available: 5.63, limit: null },
  { key: "bofa-business", institution: "BANK OF AMERICA", name: "BUSINESS ADV FUNDAMENTALS", type: "depository", subtype: "checking", ownership: "BUSINESS", role: "CAPITAL GENERATION", current: 750.68, available: 686.53, limit: null },
  { key: "schwab-checking", institution: "CHARLES SCHWAB", name: "INVESTOR CHECKING", type: "depository", subtype: "checking", ownership: "PERSONAL", role: "INVESTMENT ROUTING", current: 0.93, available: 0.93, limit: null },
  { key: "schwab-brokerage", institution: "CHARLES SCHWAB", name: "INDIVIDUAL", type: "investment", subtype: "brokerage", ownership: "PERSONAL", role: "COMPOUNDING", current: 1.78, available: 1.78, limit: null },
  { key: "amex-hysa", institution: "AMERICAN EXPRESS", name: "HIGH YIELD SAVINGS ACCOUNT", type: "depository", subtype: "savings", ownership: "PERSONAL", role: "LIQUIDITY / RESERVE", current: 0.74, available: 0.74, limit: null },
  { key: "rbfcu-checking", institution: "RBFCU", name: "CHECKING", type: "depository", subtype: "checking", ownership: "PERSONAL", role: "CASH", current: 1.0, available: 1.0, limit: null },
  { key: "rbfcu-savings", institution: "RBFCU", name: "PRIMARY SAVINGS", type: "depository", subtype: "savings", ownership: "PERSONAL", role: "CASH", current: 3.04, available: 2.04, limit: null },
  { key: "rbfcu-platinum", institution: "RBFCU", name: "PLATINUM PREMIER", type: "credit", subtype: "credit card", ownership: "AUTHORIZED_USER", role: "CREDIT CONTEXT", current: 8205.97, available: 4294.0, limit: 12500.0 },
  { key: "rbfcu-world", institution: "RBFCU", name: "WORLD CARD", type: "credit", subtype: "credit card", ownership: "PERSONAL", role: "LIABILITY", current: 598.12, available: 1.0, limit: 600.0 },
  { key: "capitalone-quicksilver", institution: "CAPITAL ONE", name: "QUICKSILVER", type: "credit", subtype: "credit card", ownership: "PERSONAL", role: "LIABILITY", current: 503.05, available: null, limit: null },
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

  const liquidity = roundMoney(
    accounts
      .filter((account) => account.type === "depository")
      .reduce((sum, account) => sum + Math.max(0, account.current), 0),
  );

  const investmentValue = roundMoney(
    accounts
      .filter((account) => account.type === "investment")
      .reduce((sum, account) => sum + account.current, 0),
  );

  const personalDebt = roundMoney(
    accounts
      .filter((account) => (account.type === "credit" || account.type === "loan") && account.ownership !== "AUTHORIZED_USER")
      .reduce((sum, account) => sum + Math.max(0, account.current), 0),
  );

  const authorizedUserBalance = roundMoney(
    accounts
      .filter((account) => (account.type === "credit" || account.type === "loan") && account.ownership === "AUTHORIZED_USER")
      .reduce((sum, account) => sum + Math.max(0, account.current), 0),
  );

  const providerNetWorth = roundMoney(liquidity + investmentValue - personalDebt - authorizedUserBalance);
  const personalNetWorth = roundMoney(liquidity + investmentValue - personalDebt);
  const { currentStage, nextStage } = determineStage({ personalDebt, liquidity });
  const goals = buildGoals({ personalDebt, liquidity, personalNetWorth });

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
    metrics: {
      personalNetWorth,
      providerNetWorth,
      liquidity,
      investmentValue,
      personalDebt,
      authorizedUserBalance,
    },
    currentStage,
    nextStage,
    goals,
    note:
      input.note?.trim().slice(0, 500) ||
      (input.mode === "DIRECT"
        ? "Direct finance state is feeding Jarvis automatically."
        : "Connected finance data has been synchronized into Jarvis, but the website is not yet independently refreshing the provider connection."),
  };
}

export async function getOrSeedFinanceState(): Promise<FinanceRuntimeState> {
  const existing = await getFinanceState();
  if (existing) return existing;

  const seeded = buildFinanceState({
    accounts: SEEDED_ACCOUNTS,
    liabilities: SEEDED_LIABILITIES,
    mode: "SYNCED_SNAPSHOT",
    source: "CHATGPT FINANCES",
    asOf: "2026-09-15T23:05:29.722Z",
    connectionCount: 7,
    transactionHistory: "FULL HISTORY READY",
    recurringHistory: "FULL HISTORY READY",
    note: "Real connected-account snapshot. Jarvis is ready for automatic provider refresh, but direct provider credentials are not connected to the website yet.",
  });

  await setFinanceState(seeded);
  return seeded;
}

export async function ingestFinanceState(input: Parameters<typeof buildFinanceState>[0]): Promise<FinanceRuntimeState> {
  const previous = await getFinanceState();
  const next = buildFinanceState(input);
  await setFinanceState(next);

  const changed = !previous || financeFingerprint(previous) !== financeFingerprint(next);
  if (changed) {
    await appendRuntimeEvent(
      createRuntimeEvent({
        type: "finance.state_updated",
        domain: "FINANCE",
        source: next.mode === "DIRECT" ? "jarvis.finance.direct" : "jarvis.finance.snapshot",
        importance: "NORMAL",
        summary: `Finance refreshed: ${money(next.metrics.liquidity)} liquid, ${money(next.metrics.personalDebt)} personal debt, ${signedMoney(next.metrics.personalNetWorth)} adjusted net worth.`,
      }),
    );
  }

  return next;
}

export function financeDirective(state: FinanceRuntimeState): string {
  if (state.metrics.personalDebt > 0) {
    return `Protect operating cash and eliminate ${money(state.metrics.personalDebt)} of personal revolving debt before accelerating lifestyle spending.`;
  }
  if (state.metrics.liquidity < TEN_K) {
    return `Debt is controlled. Build liquid reserves from ${money(state.metrics.liquidity)} toward ${money(TEN_K)}.`;
  }
  return `Protect liquidity and move excess capital toward the next ${money(getNextNetWorthMilestone(state.metrics.personalNetWorth).target)} net-worth milestone.`;
}

function buildGoals(input: { personalDebt: number; liquidity: number; personalNetWorth: number }): FinanceGoalState[] {
  const milestone = getNextNetWorthMilestone(input.personalNetWorth);
  const liquidProgress = clampPercent((input.liquidity / TEN_K) * 100);
  const millionProgress = clampPercent((Math.max(0, input.personalNetWorth) / ONE_MILLION) * 100);

  return [
    {
      name: "DEBT FREEDOM",
      state: input.personalDebt <= 0 ? "GREEN" : "RED",
      progress: input.personalDebt <= 0 ? 100 : null,
      current: input.personalDebt <= 0 ? "$0 personal debt" : `${money(input.personalDebt)} personal debt`,
      target: "$0",
      blocker: input.personalDebt <= 0 ? "Complete." : "Clear personal revolving balances without draining operating liquidity.",
    },
    {
      name: "$10K LIQUID",
      state: input.liquidity >= TEN_K ? "GREEN" : liquidProgress >= 50 ? "YELLOW" : "RED",
      progress: liquidProgress,
      current: money(input.liquidity),
      target: money(TEN_K),
      blocker: input.liquidity >= TEN_K ? "Complete." : `${money(TEN_K - input.liquidity)} remaining.`,
    },
    {
      name: "NET WORTH MILESTONE",
      state: milestone.progress >= 70 ? "YELLOW" : "RED",
      progress: milestone.progress,
      current: signedMoney(input.personalNetWorth),
      target: money(milestone.target),
      blocker: `Target rolls by ${money(milestone.step)} when reached; after $100,000 each new milestone advances by $10,000.`,
    },
    {
      name: "MOVE OUT",
      state: "SETUP",
      progress: null,
      current: "Criteria not locked",
      target: "Readiness gate",
      blocker: "Housing budget, move-in capital, reserve floor and income-consistency gates still need to be locked.",
    },
    {
      name: "GR SUPRA",
      state: "SETUP",
      progress: null,
      current: "Criteria not locked",
      target: "Readiness gate",
      blocker: "Purchase price, down payment, insurance and post-purchase liquidity gates still need to be locked.",
    },
    {
      name: "$1M NET WORTH",
      state: input.personalNetWorth >= ONE_MILLION ? "GREEN" : millionProgress >= 50 ? "YELLOW" : "RED",
      progress: millionProgress,
      current: signedMoney(input.personalNetWorth),
      target: "$1,000,000",
      blocker: input.personalNetWorth >= ONE_MILLION ? "Complete." : "Long-horizon destination; rolling milestones keep the path measurable.",
    },
  ];
}

function determineStage(input: { personalDebt: number; liquidity: number }) {
  if (input.personalDebt > 0) return { currentStage: "DEBT", nextStage: "STABILITY" };
  if (input.liquidity < 2_500) return { currentStage: "STABILITY", nextStage: "RESERVES" };
  if (input.liquidity < TEN_K) return { currentStage: "RESERVES", nextStage: "CREDIT" };
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

function safeNumber(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function money(value: number) {
  return `$${Math.max(0, value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function signedMoney(value: number) {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
