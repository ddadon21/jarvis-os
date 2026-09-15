import type { MinorUnits, ReadinessLevel } from "@/core/types";

/**
 * Finance domain types.
 *
 * The central idea: an account's *purpose* is a first-class field. A balance
 * alone cannot tell Jarvis whether $4,000 sitting somewhere is an emergency
 * fund, a tax reserve it must not touch, or idle cash that should be paying
 * down a 24% APR card. Purpose is what makes allocation advice possible.
 */

export const accountKinds = [
  "checking",
  "savings",
  "hysa",
  "business_checking",
  "credit_card",
  "loan",
  "brokerage",
  "retirement",
  "trading",
  "cash",
  "other",
] as const;
export type AccountKind = (typeof accountKinds)[number];

/** What the money in this account is *for*. Drives allocation, not reporting. */
export const accountPurposes = [
  "operating",
  "personal_bills",
  "emergency_reserve",
  "tax_reserve",
  "debt_service",
  "long_term_investing",
  "risk_capital",
  "business_operating",
  "sinking_fund",
  "unassigned",
] as const;
export type AccountPurpose = (typeof accountPurposes)[number];

export interface FinancialAccount {
  readonly id: string;
  readonly userId: string;
  readonly label: string;
  readonly institution: string;
  readonly kind: AccountKind;
  readonly purpose: AccountPurpose;
  readonly currency: string;
  /** Positive for assets, positive-as-owed for liabilities — see `isLiability`. */
  readonly balance: MinorUnits;
  readonly isLiability: boolean;
  readonly creditLimit?: MinorUnits;
  readonly interestRateBps?: number;
  /** Last successful sync from a provider. Absent means manually maintained. */
  readonly lastSyncedAt?: string;
  readonly active: boolean;
}

export const transactionDirections = ["inflow", "outflow", "transfer"] as const;
export type TransactionDirection = (typeof transactionDirections)[number];

export interface FinancialTransaction {
  readonly id: string;
  readonly userId: string;
  readonly accountId: string;
  readonly postedAt: string;
  readonly amount: MinorUnits;
  readonly direction: TransactionDirection;
  readonly description: string;
  readonly merchant?: string;
  readonly category?: string;
  /** Business vs personal. Kept separate from category — a meal can be either. */
  readonly isBusiness: boolean;
  /** True when a classification was inferred rather than confirmed by the user. */
  readonly classificationInferred: boolean;
  readonly counterpartyAccountId?: string;
  readonly externalId?: string;
}

export interface Debt {
  readonly id: string;
  readonly userId: string;
  readonly accountId?: string;
  readonly label: string;
  readonly originalBalance: MinorUnits;
  readonly currentBalance: MinorUnits;
  readonly interestRateBps: number;
  readonly minimumPayment: MinorUnits;
  readonly dueDayOfMonth?: number;
  readonly payoffPriority?: number;
}

export interface Investment {
  readonly id: string;
  readonly userId: string;
  readonly accountId: string;
  readonly symbol: string;
  readonly quantity: number;
  readonly costBasis: MinorUnits;
  readonly marketValue: MinorUnits;
  readonly asOf: string;
}

/** Point-in-time financial position. The series behind net-worth tracking. */
export interface FinancialSnapshot {
  readonly id: string;
  readonly userId: string;
  readonly capturedAt: string;
  readonly totalAssets: MinorUnits;
  readonly totalLiabilities: MinorUnits;
  readonly netWorth: MinorUnits;
  readonly liquidCash: MinorUnits;
  readonly monthlyIncome: MinorUnits;
  readonly monthlyExpenses: MinorUnits;
  readonly creditUtilization: number;
}

/**
 * How incoming capital should be split.
 *
 * Rules are versioned and time-bounded because the correct split changes with
 * the user's stage — aggressive debt payoff early, investing later. The stage
 * that produced a rule is recorded so past advice stays interpretable.
 */
export const capitalStages = [
  "debt",
  "stability",
  "cash_reserves",
  "credit",
  "capital",
  "investing",
  "asset_ownership",
] as const;
export type CapitalStage = (typeof capitalStages)[number];

export interface AllocationRule {
  readonly id: string;
  readonly userId: string;
  readonly stage: CapitalStage;
  readonly purpose: AccountPurpose;
  /** 0..1 share of each inbound dollar. Shares across a stage sum to 1. */
  readonly share: number;
  readonly floorAmount?: MinorUnits;
  readonly capAmount?: MinorUnits;
  readonly effectiveFrom: string;
  readonly effectiveUntil?: string;
  readonly rationale: string;
}

/** A concrete proposed split of a specific inflow. */
export interface AllocationProposal {
  readonly incomeAmount: MinorUnits;
  readonly stage: CapitalStage;
  readonly lines: readonly {
    readonly purpose: AccountPurpose;
    readonly amount: MinorUnits;
    readonly rationale: string;
  }[];
  readonly goalImpacts: readonly {
    readonly goalSlug: string;
    readonly readinessBefore: ReadinessLevel;
    readonly readinessAfter: ReadinessLevel;
  }[];
}
