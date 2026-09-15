import type { TradingSnapshot, TradingSource } from "@/domains/trading/ports";
import type { FinanceSnapshot, FinanceSource } from "@/domains/finance/ports";
import type { SentryOpsSnapshot, SentryOpsSource } from "@/domains/sentryops/ports";
import type { LifeSnapshot, LifeSource } from "@/domains/life/ports";
import { isoDaysAgo, isoHoursFromNow, nowIso } from "@/lib/time";

/**
 * DEVELOPMENT DATA — see src/dev/notice.ts.
 *
 * These implement the domain read ports with invented figures. When a real
 * provider adapter arrives it implements the same interface and is swapped in
 * `src/server/container.ts`; nothing in the domain modules changes.
 *
 * The numbers are chosen to exercise the interesting branches — a journal
 * backlog, idle cash against high-APR debt, an open RFP with a deadline, an
 * evidence-blocked hypothesis — rather than to describe anyone's real position.
 */

export const devTradingSource: TradingSource = {
  async getSnapshot(): Promise<TradingSnapshot> {
    return {
      mode: "paper",
      accountCount: 2,
      openPositions: 0,
      datasetSize: 41,
      performance: {
        tradeCount: 41,
        winRate: 0.44,
        expectancyR: 0.18,
        totalR: 7.4,
        netPnl: 182_400,
        maxDrawdownR: -4.2,
        planAdherenceRate: 0.68,
      },
      unjournaledTrades: 3,
      skippedSetups: 12,
      modelConfidence: 0.22,
      equity: 1_182_400,
      observedAt: nowIso(),
    };
  },
};

export const devFinanceSource: FinanceSource = {
  async getSnapshot(): Promise<FinanceSnapshot> {
    return {
      netWorth: 1_845_000,
      liquidCash: 620_000,
      totalDebt: 940_000,
      monthlyIncome: 540_000,
      monthlyExpenses: 398_000,
      creditUtilization: 0.34,
      stage: "debt",
      unassignedCash: 180_000,
      accountsMissingPurpose: 2,
      runwayMonths: 1.6,
      untaggedTransactions: 47,
      upcomingDebtPayments: [
        { label: "Auto loan", amount: 42_800, dueAt: isoHoursFromNow(52) },
        { label: "Card — Visa", amount: 15_000, dueAt: isoHoursFromNow(196) },
      ],
      highestAprDebt: { label: "Card — Visa", aprBps: 2_449, balance: 310_000 },
      purposeBreakdown: [
        { purpose: "personal_bills", amount: 240_000 },
        { purpose: "emergency_reserve", amount: 200_000 },
        { purpose: "risk_capital", amount: 1_182_400 },
        { purpose: "unassigned", amount: 180_000 },
      ],
      observedAt: nowIso(),
    };
  },
};

export const devSentryOpsSource: SentryOpsSource = {
  async getSnapshot(): Promise<SentryOpsSnapshot> {
    return {
      agenciesTracked: 6,
      observationsRecorded: 9,
      observationsValidated: 2,
      contractsTracked: 4,
      competitorsTracked: 5,
      openRfps: [
        {
          title: "County records management modernisation",
          dueAt: isoHoursFromNow(120),
          estimatedValue: 18_000_000,
        },
      ],
      activeHypotheses: [
        {
          id: "h_evidence_intake",
          statement: "Evidence intake is manual at small-county sheriff offices",
          stage: "market_frequency",
          confidence: 0.45,
          evidenceSufficient: false,
        },
        {
          id: "h_shift_handoff",
          statement: "Shift handoff notes are kept outside any system of record",
          stage: "validation",
          confidence: 0.3,
          evidenceSufficient: false,
        },
      ],
      marketValidation: 0.28,
      productReadiness: 0.15,
      pilotReadiness: 0.05,
      observedAt: isoDaysAgo(1),
    };
  },
};

export const devLifeSource: LifeSource = {
  async getSnapshot(): Promise<LifeSnapshot> {
    return {
      upcomingCommitments: [
        { title: "Agency ride-along debrief", startsAt: isoHoursFromNow(28) },
        { title: "Quarterly tax estimate due", startsAt: isoHoursFromNow(150), financialImpact: 120_000 },
      ],
      openDecisions: [
        { title: "Move out of family home", goalSlug: "move_out", estimatedCost: 450_000 },
        { title: "GR Supra purchase", goalSlug: "supra", estimatedCost: 5_200_000 },
      ],
      unaccountedCommitmentCost: 120_000,
      observedAt: nowIso(),
    };
  },
};
