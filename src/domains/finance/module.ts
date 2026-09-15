import type { DomainContext, DomainModule } from "@/core/domain-module";
import type { MoveCandidate } from "@/core/next-move/types";
import type { WorldStateSlice } from "@/core/world-state/types";
import { factors } from "@/core/next-move/scoring";
import type { FinanceSnapshot, FinanceSource } from "@/domains/finance/ports";

/**
 * Finance Jarvis.
 *
 * Thinks like a CFO: every dollar has a job, and the question is never "can I
 * afford this?" but "what does this cost the goals I said mattered?". Note
 * that this module proposes moves with concrete dollar impact attached —
 * expected value is what lets a debt payment compete fairly against a trading
 * task in the Next Move ranking.
 */
export class FinanceModule implements DomainModule {
  readonly domain = "finance" as const;
  readonly mission =
    "Understand the whole financial system and direct capital from debt toward independence, one measured allocation at a time.";

  constructor(private readonly source: FinanceSource) {}

  async getStateSlice(context: DomainContext): Promise<WorldStateSlice> {
    const snapshot = await this.source.getSnapshot(context.userId);
    const monthlyNet = snapshot.monthlyIncome - snapshot.monthlyExpenses;

    return {
      domain: this.domain,
      headline: `${stageLabel(snapshot.stage)} stage — ${snapshot.runwayMonths.toFixed(1)} months of reserve.`,
      metrics: [
        { key: "net_worth", label: "Net worth", value: snapshot.netWorth, format: "currency", polarity: "higher_is_better" },
        { key: "liquid_cash", label: "Cash", value: snapshot.liquidCash, format: "currency", polarity: "higher_is_better" },
        { key: "total_debt", label: "Debt", value: snapshot.totalDebt, format: "currency", polarity: "lower_is_better" },
        {
          key: "monthly_net",
          label: "Monthly net",
          value: monthlyNet,
          format: "currency",
          polarity: "higher_is_better",
          caption: "income less expenses",
        },
        {
          key: "credit_utilization",
          label: "Utilisation",
          value: snapshot.creditUtilization,
          format: "percent",
          polarity: "lower_is_better",
        },
        {
          key: "runway_months",
          label: "Runway",
          value: snapshot.runwayMonths,
          format: "duration",
          polarity: "higher_is_better",
          caption: "months of expenses covered",
        },
      ],
      flags: [snapshot.stage, ...(snapshot.accountsMissingPurpose > 0 ? ["accounts_unassigned"] : [])],
      dataQuality: "mock",
      observedAt: snapshot.observedAt,
    };
  }

  async proposeMoves(context: DomainContext): Promise<MoveCandidate[]> {
    const snapshot = await this.source.getSnapshot(context.userId);
    const moves: MoveCandidate[] = [];

    const nextPayment = [...snapshot.upcomingDebtPayments].sort(
      (a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt),
    )[0];

    if (nextPayment) {
      moves.push({
        id: "finance.debt_payment",
        userId: context.userId,
        domain: this.domain,
        title: `${nextPayment.label} payment due`,
        summary: "A missed payment costs a fee, interest and credit score — the most expensive avoidable error available.",
        dueAt: nextPayment.dueAt,
        requiredActionLevel: "prepare",
        sourceKind: "agent",
        sourceId: "finance.cfo",
        factors: factors({
          urgency: 0.9,
          // Expected value here is the loss avoided, not the payment itself.
          expectedValue: Math.round(nextPayment.amount * 0.1),
          goalAlignment: 0.8,
          strategicImportance: 0.7,
          contextFit: 0.8,
          probabilityOfSuccess: 0.98,
          risk: 0.1,
          reversibility: 0.3,
          estimatedMinutes: 10,
        }),
      });
    }

    if (snapshot.unassignedCash > 0 && snapshot.highestAprDebt) {
      const debt = snapshot.highestAprDebt;
      const deployable = Math.min(snapshot.unassignedCash, debt.balance);
      // Annual interest avoided by deploying idle cash against the worst APR.
      const annualInterestAvoided = Math.round((deployable * debt.aprBps) / 10_000);

      moves.push({
        id: "finance.deploy_idle_cash",
        userId: context.userId,
        domain: this.domain,
        title: `Deploy idle cash against ${debt.label}`,
        summary: `Unassigned cash is earning nothing while ${debt.label} accrues at ${(debt.aprBps / 100).toFixed(2)}%.`,
        requiredActionLevel: "prepare",
        sourceKind: "agent",
        sourceId: "finance.cfo",
        factors: factors({
          urgency: 0.4,
          expectedValue: annualInterestAvoided,
          goalAlignment: 0.9,
          strategicImportance: 0.7,
          contextFit: 0.6,
          probabilityOfSuccess: 0.9,
          risk: 0.25,
          // Money sent to a card is hard to get back if it was needed elsewhere.
          reversibility: 0.2,
          estimatedMinutes: 15,
        }),
      });
    }

    if (snapshot.accountsMissingPurpose > 0) {
      moves.push({
        id: "finance.assign_account_purposes",
        userId: context.userId,
        domain: this.domain,
        title: `Assign a purpose to ${snapshot.accountsMissingPurpose} accounts`,
        summary:
          "Allocation advice is only as good as the account model behind it. An account with no purpose cannot be reasoned about.",
        requiredActionLevel: "recommend",
        sourceKind: "agent",
        sourceId: "finance.cfo",
        factors: factors({
          urgency: 0.3,
          goalAlignment: 0.5,
          strategicImportance: 0.8,
          contextFit: 0.5,
          probabilityOfSuccess: 0.95,
          estimatedMinutes: 20,
        }),
      });
    }

    return moves;
  }
}

function stageLabel(stage: FinanceSnapshot["stage"]): string {
  const labels: Record<FinanceSnapshot["stage"], string> = {
    debt: "Debt payoff",
    stability: "Stability",
    cash_reserves: "Cash reserves",
    credit: "Credit building",
    capital: "Capital accumulation",
    investing: "Investing",
    asset_ownership: "Asset ownership",
  };
  return labels[stage];
}
