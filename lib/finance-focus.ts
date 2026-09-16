import type { FinanceRuntimeState } from "./jarvis-runtime";

export type FinanceFocus = {
  stage: string;
  title: string;
  reason: string;
  nextStep: string;
  moneyInRule: string;
  moneyOutRule: string;
  targetLabel: string;
};

export type FinanceMovementVerdict = "ALIGNED" | "NEEDS_CONTEXT" | "MISALIGNED";

export type FinanceMovement = {
  direction: "IN" | "OUT";
  amount: number;
  category?: string | null;
  description?: string | null;
  isTransfer?: boolean;
  isDebtPayment?: boolean;
  isRequired?: boolean;
};

export function deriveFinanceFocus(state: FinanceRuntimeState): FinanceFocus {
  if (state.metrics.personalDebt > 0) {
    const debts = state.accounts
      .filter((account) => (account.type === "credit" || account.type === "loan") && account.ownership !== "AUTHORIZED_USER" && account.current > 0)
      .map((account) => {
        const liability = state.liabilities.find((item) => item.accountKey === account.key);
        const utilization = account.limit && account.limit > 0 ? (account.current / account.limit) * 100 : null;
        return { account, liability, utilization };
      })
      .sort((a, b) => {
        const aprA = a.liability?.apr ?? -1;
        const aprB = b.liability?.apr ?? -1;
        if (aprA !== aprB) return aprB - aprA;
        return (b.utilization ?? -1) - (a.utilization ?? -1);
      });

    const target = debts[0];
    const details = target
      ? [
          target.liability?.apr != null ? `${target.liability.apr.toFixed(1)}% APR` : null,
          target.utilization != null ? `${target.utilization.toFixed(1)}% utilized` : null,
        ].filter(Boolean).join(" · ")
      : "highest-cost balance";

    return {
      stage: "DEBT",
      title: "CLEAR PERSONAL REVOLVING DEBT",
      reason: `${money(state.metrics.personalDebt)} of personal revolving debt is the current drag on net worth, credit flexibility, and capital growth.`,
      nextStep: target
        ? `Protect enough operating cash to avoid recreating debt, then route the next safe debt dollar to ${target.account.name}${details ? ` (${details})` : ""}.`
        : "Protect enough operating cash to avoid recreating debt, then route the next safe debt dollar to the highest-cost personal revolving balance.",
      moneyInRule: "New money gets assigned before it gets spent: protect required operating cash, then attack the active debt target.",
      moneyOutRule: "Required spending can pass. Discretionary spending should be challenged whenever it delays the debt target or increases utilization.",
      targetLabel: target?.account.name ?? "PERSONAL DEBT",
    };
  }

  if (state.metrics.liquidity < 2_500) {
    return {
      stage: "STABILITY",
      title: "BUILD A $2.5K CASH FLOOR",
      reason: "Debt is controlled, but the cash buffer is still too small to absorb normal surprises without falling backward.",
      nextStep: `Build liquid cash from ${money(state.metrics.liquidity)} to $2,500 before expanding lifestyle spending.`,
      moneyInRule: "Route new money to the cash floor until it is complete.",
      moneyOutRule: "Challenge nonessential outflows that reduce the cash floor or recreate reliance on credit.",
      targetLabel: "$2.5K CASH FLOOR",
    };
  }

  if (state.metrics.personalNetWorth < 5_000) {
    return {
      stage: "RESERVES",
      title: "REACH $5K NET WORTH",
      reason: "The next objective is to turn stability into a positive capital base while keeping revolving debt at zero.",
      nextStep: `Advance adjusted net worth from ${signedMoney(state.metrics.personalNetWorth)} to $5,000 through cash reserves and productive capital.` ,
      moneyInRule: "Use surplus cash to strengthen reserves and productive capital instead of immediately increasing lifestyle spend.",
      moneyOutRule: "Outflows should protect the reserve trajectory and avoid new revolving balances.",
      targetLabel: "$5K NET WORTH",
    };
  }

  return {
    stage: state.currentStage,
    title: "GROW CAPITAL WITHOUT LOSING CONTROL",
    reason: "The financial foundation is strong enough to focus more aggressively on credit optimization, scalable cash flow, investing, and productive assets.",
    nextStep: "Protect the cash floor, keep consumer debt at zero, and direct surplus capital toward the next measurable wealth milestone.",
    moneyInRule: "New capital should increasingly fund scalable cash-flow engines and productive assets.",
    moneyOutRule: "Lifestyle expansion must not damage liquidity, credit, or the active wealth milestone.",
    targetLabel: "NEXT WEALTH MILESTONE",
  };
}

export function critiqueFinanceMovement(state: FinanceRuntimeState, movement: FinanceMovement) {
  const focus = deriveFinanceFocus(state);
  const amount = Math.max(0, movement.amount);

  if (movement.isTransfer) {
    return {
      verdict: "NEEDS_CONTEXT" as FinanceMovementVerdict,
      summary: `${money(amount)} transfer detected. Do not treat it as income or spending until the source and destination are reconciled.`,
      nextStep: focus.nextStep,
    };
  }

  if (movement.direction === "IN") {
    return {
      verdict: "ALIGNED" as FinanceMovementVerdict,
      summary: `${money(amount)} came in. Assign it against the active ${focus.stage.toLowerCase()} focus before lifestyle spending expands.`,
      nextStep: focus.nextStep,
    };
  }

  if (movement.isDebtPayment) {
    return {
      verdict: "ALIGNED" as FinanceMovementVerdict,
      summary: `${money(amount)} debt payment moves the active focus forward as long as operating cash remains protected.`,
      nextStep: focus.nextStep,
    };
  }

  if (movement.isRequired) {
    return {
      verdict: "ALIGNED" as FinanceMovementVerdict,
      summary: `${money(amount)} required outflow is compatible with the plan; Jarvis should still watch whether the amount or cadence can be improved.`,
      nextStep: focus.nextStep,
    };
  }

  return {
    verdict: state.metrics.personalDebt > 0 ? "MISALIGNED" as FinanceMovementVerdict : "NEEDS_CONTEXT" as FinanceMovementVerdict,
    summary: state.metrics.personalDebt > 0
      ? `${money(amount)} discretionary outflow works against the current debt focus unless it has a higher-priority purpose.`
      : `${money(amount)} discretionary outflow needs to be judged against the current capital goal.`,
    nextStep: focus.nextStep,
  };
}

function money(value: number) {
  return `$${Math.max(0, value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function signedMoney(value: number) {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
