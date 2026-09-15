import type { MinorUnits } from "@/core/types";
import type { AccountPurpose, CapitalStage } from "@/domains/finance/types";

export interface FinanceSnapshot {
  readonly netWorth: MinorUnits;
  readonly liquidCash: MinorUnits;
  readonly totalDebt: MinorUnits;
  readonly monthlyIncome: MinorUnits;
  readonly monthlyExpenses: MinorUnits;
  readonly creditUtilization: number;
  readonly stage: CapitalStage;
  /** Cash sitting in accounts with no assigned purpose. Unassigned money drifts. */
  readonly unassignedCash: MinorUnits;
  readonly accountsMissingPurpose: number;
  /** Months of expenses covered by the emergency reserve. */
  readonly runwayMonths: number;
  readonly untaggedTransactions: number;
  readonly upcomingDebtPayments: readonly {
    readonly label: string;
    readonly amount: MinorUnits;
    readonly dueAt: string;
  }[];
  readonly highestAprDebt?: { readonly label: string; readonly aprBps: number; readonly balance: MinorUnits };
  readonly purposeBreakdown: readonly { readonly purpose: AccountPurpose; readonly amount: MinorUnits }[];
  readonly observedAt: string;
}

export interface FinanceSource {
  getSnapshot(userId: string): Promise<FinanceSnapshot>;
}
