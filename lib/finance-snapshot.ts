export type FinanceDebt = {
  name: string;
  balance: number;
  apr: number | null;
  minimum: number | null;
  due: string | null;
  ownership: "PERSONAL" | "AUTHORIZED_USER";
  limit: number | null;
};

export type FinanceGoalReadiness = {
  name: string;
  state: "RED" | "YELLOW" | "GREEN" | "SETUP";
  progress: number | null;
  current: string;
  target: string;
  blocker: string;
};

function formatWholeMoney(value: number) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function getNextNetWorthMilestone(netWorth: number) {
  const step = netWorth < 100000 ? 5000 : 10000;
  const floor = Math.max(0, Math.floor(Math.max(netWorth, 0) / step) * step);
  const target = floor + step;
  const progress = netWorth <= floor ? 0 : Math.min(100, ((netWorth - floor) / step) * 100);
  return { floor, target, step, progress };
}

const CURRENT_PERSONAL_NET_WORTH = -277.10;
export const NET_WORTH_MILESTONE = getNextNetWorthMilestone(CURRENT_PERSONAL_NET_WORTH);

export const FINANCE_SNAPSHOT = {
  importedAt: "2026-09-15",
  source: "CHATGPT FINANCES",
  connectionCount: 7,
  accountCount: 11,
  transactionHistory: "FULL HISTORY READY",
  recurringHistory: "FULL HISTORY READY",
  personalNetWorth: CURRENT_PERSONAL_NET_WORTH,
  providerNetWorth: -8483.07,
  liquidity: 822.29,
  investmentValue: 1.78,
  personalDebt: 1101.17,
  authorizedUserBalance: 8205.97,
  septemberSpend: 798.46,
  septemberCreditsDetected: 1747.05,
  creditsPostedThrough: "SEP 14",
  currentStage: "DEBT",
  nextStage: "STABILITY",
  nextNetWorthMilestone: NET_WORTH_MILESTONE.target,
  netWorthMilestoneStep: NET_WORTH_MILESTONE.step,
  note: "Phase 1 synchronized snapshot. Connected data is usable in ChatGPT; Jarvis does not yet have an independent direct bank feed, so the site does not auto-refresh balances by itself yet.",
} as const;

export const FINANCE_DEBTS: FinanceDebt[] = [
  {
    name: "RBFCU WORLD CARD",
    balance: 598.12,
    apr: 18,
    minimum: 25,
    due: "SEP 21",
    ownership: "PERSONAL",
    limit: 600,
  },
  {
    name: "CAPITAL ONE QUICKSILVER",
    balance: 503.05,
    apr: null,
    minimum: 25,
    due: "SEP 14",
    ownership: "PERSONAL",
    limit: null,
  },
  {
    name: "RBFCU PLATINUM PREMIER",
    balance: 8205.97,
    apr: 11.2,
    minimum: 0,
    due: "OCT 04",
    ownership: "AUTHORIZED_USER",
    limit: 12500,
  },
];

export const FINANCE_ACCOUNT_PURPOSES = [
  { institution: "BOFA BUSINESS", role: "CAPITAL GENERATION", detail: "$750.68 · business income, payouts and operating cash" },
  { institution: "CHASE", role: "PERSONAL CONTROL", detail: "$60.27 · personal routing and debt-elimination cash" },
  { institution: "AMEX HYSA", role: "LIQUIDITY / RESERVE", detail: "$0.74 · emergency reserves and near-term runway" },
  { institution: "SCHWAB", role: "COMPOUNDING", detail: "$2.71 combined · checking + brokerage · long-term wealth" },
  { institution: "RBFCU", role: "CASH + CREDIT", detail: "$4.04 cash · World Card personal · Platinum tracked as authorized-user" },
  { institution: "BOFA PERSONAL", role: "CONTROLLED BILLS", detail: "$5.63 · temporary subscriptions and recurring personal bills" },
] as const;

export const FINANCE_GOALS: FinanceGoalReadiness[] = [
  {
    name: "DEBT FREEDOM",
    state: "RED",
    progress: null,
    current: "$1,101.17 personal debt",
    target: "$0",
    blocker: "Clear personal revolving balances while keeping enough operating cash to avoid recreating debt.",
  },
  {
    name: "$10K LIQUID",
    state: "RED",
    progress: 8.2229,
    current: "$822.29",
    target: "$10,000",
    blocker: "$9,177.71 remaining.",
  },
  {
    name: "NET WORTH MILESTONE",
    state: "RED",
    progress: NET_WORTH_MILESTONE.progress,
    current: "-$277.10",
    target: formatWholeMoney(NET_WORTH_MILESTONE.target),
    blocker: `Milestone rolls forward by ${formatWholeMoney(NET_WORTH_MILESTONE.step)} when reached; after $100,000 the step becomes $10,000.`,
  },
  {
    name: "MOVE OUT",
    state: "SETUP",
    progress: null,
    current: "Criteria not locked",
    target: "Readiness gate",
    blocker: "Need housing budget, reserve floor, move-in capital and income-consistency rules.",
  },
  {
    name: "GR SUPRA",
    state: "SETUP",
    progress: null,
    current: "Criteria not locked",
    target: "Readiness gate",
    blocker: "Need purchase price, down payment, insurance and post-purchase liquidity rules.",
  },
  {
    name: "$1M NET WORTH",
    state: "RED",
    progress: 0,
    current: "-$277.10",
    target: "$1,000,000",
    blocker: "Long-horizon destination; Jarvis tracks the smaller rolling milestones on the way there.",
  },
];

export const FINANCE_STAGES = [
  "DEBT",
  "STABILITY",
  "RESERVES",
  "CREDIT",
  "CAPITAL",
  "INVESTING",
  "ASSETS",
] as const;
