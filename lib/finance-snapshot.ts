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

export const FINANCE_SNAPSHOT = {
  importedAt: "2026-09-15",
  source: "CHATGPT FINANCES",
  connectionCount: 7,
  accountCount: 11,
  transactionHistory: "FULL HISTORY READY",
  recurringHistory: "FULL HISTORY READY",
  personalNetWorth: -277.10,
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
  note: "Sanitized Phase 1 import. Connected data is usable in ChatGPT; Jarvis does not yet have an independent direct bank feed.",
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
    blocker: "Store a debt-baseline date before showing a real payoff percentage.",
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
    name: "$100K NET WORTH",
    state: "RED",
    progress: 0,
    current: "-$277.10",
    target: "$100,000",
    blocker: "Debt elimination and positive capital accumulation come first.",
  },
  {
    name: "$1M NET WORTH",
    state: "RED",
    progress: 0,
    current: "-$277.10",
    target: "$1,000,000",
    blocker: "Long-horizon goal; no decorative percentage while net worth is below zero.",
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
