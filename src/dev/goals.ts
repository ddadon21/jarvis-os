import type { Goal, GoalCriterion } from "@/core/goals/types";
import { DEV_USER_ID } from "@/dev/notice";
import { isoDaysAgo } from "@/lib/time";

/**
 * DEVELOPMENT DATA — see src/dev/notice.ts.
 *
 * These goals exist to exercise the readiness engine across all three levels
 * and both criterion directions. The criteria sets are modelled on the real
 * structure the system is meant to support (a move-out decision genuinely does
 * depend on six independent things) but every figure is invented.
 */

function criterion(
  goalId: string,
  input: Omit<GoalCriterion, "id" | "goalId" | "weight" | "blocking" | "source"> &
    Partial<Pick<GoalCriterion, "weight" | "blocking" | "source">>,
): GoalCriterion {
  return {
    id: `${goalId}__${input.key}`,
    goalId,
    weight: 1,
    blocking: false,
    source: "dev",
    ...input,
  };
}

function goal(
  input: Omit<Goal, "userId" | "criteria" | "createdAt" | "status"> & {
    criteria: (goalId: string) => GoalCriterion[];
    status?: Goal["status"];
  },
): Goal {
  return {
    userId: DEV_USER_ID,
    status: input.status ?? "active",
    createdAt: isoDaysAgo(120),
    id: input.id,
    domain: input.domain,
    slug: input.slug,
    title: input.title,
    displayOrder: input.displayOrder,
    ...(input.description ? { description: input.description } : {}),
    ...(input.targetDate ? { targetDate: input.targetDate } : {}),
    criteria: input.criteria(input.id),
  };
}

export const devGoals: Goal[] = [
  goal({
    id: "goal_debt_free",
    domain: "finance",
    slug: "debt_free",
    title: "Debt free",
    description: "No consumer debt outstanding.",
    displayOrder: 0,
    criteria: (id) => [
      criterion(id, {
        key: "consumer_debt",
        label: "Consumer debt balance",
        unit: "currency",
        direction: "at_most",
        greenThreshold: 0,
        yellowThreshold: 200_000,
        baselineValue: 1_400_000,
        currentValue: 940_000,
        weight: 3,
        blocking: true,
      }),
      criterion(id, {
        key: "monthly_surplus",
        label: "Monthly surplus",
        unit: "currency",
        direction: "at_least",
        greenThreshold: 150_000,
        yellowThreshold: 75_000,
        currentValue: 142_000,
        weight: 2,
      }),
      criterion(id, {
        key: "no_new_debt",
        label: "No new debt in 90 days",
        unit: "boolean",
        direction: "at_least",
        greenThreshold: 1,
        yellowThreshold: 1,
        currentValue: 1,
      }),
    ],
  }),

  goal({
    id: "goal_cash_10k",
    domain: "finance",
    slug: "cash_10k",
    title: "$10K cash reserve",
    displayOrder: 1,
    criteria: (id) => [
      criterion(id, {
        key: "liquid_cash",
        label: "Liquid cash",
        unit: "currency",
        direction: "at_least",
        greenThreshold: 1_000_000,
        yellowThreshold: 500_000,
        currentValue: 620_000,
        weight: 3,
      }),
      criterion(id, {
        key: "reserve_untouched",
        label: "Reserve untouched 60 days",
        unit: "boolean",
        direction: "at_least",
        greenThreshold: 1,
        yellowThreshold: 1,
        // Set so at least one development goal lands on YELLOW: a fixture set
        // that is uniformly RED cannot show that the rollup distinguishes levels.
        currentValue: 1,
      }),
    ],
  }),

  goal({
    id: "goal_move_out",
    domain: "life",
    slug: "move_out",
    title: "Move out",
    description: "Sustainably support an independent household.",
    displayOrder: 2,
    criteria: (id) => [
      criterion(id, {
        key: "income_consistency",
        label: "Income consistency",
        unit: "months",
        direction: "at_least",
        greenThreshold: 6,
        yellowThreshold: 3,
        currentValue: 3.5,
        weight: 2,
        blocking: true,
      }),
      criterion(id, {
        key: "emergency_reserve",
        label: "Emergency reserve",
        unit: "currency",
        direction: "at_least",
        greenThreshold: 900_000,
        yellowThreshold: 450_000,
        currentValue: 200_000,
        weight: 2,
      }),
      criterion(id, {
        key: "debt_position",
        label: "Debt position",
        unit: "currency",
        direction: "at_most",
        greenThreshold: 300_000,
        yellowThreshold: 800_000,
        baselineValue: 1_400_000,
        currentValue: 940_000,
        weight: 2,
      }),
      criterion(id, {
        key: "credit_utilization",
        label: "Credit utilisation",
        unit: "percent",
        direction: "at_most",
        greenThreshold: 0.1,
        yellowThreshold: 0.3,
        currentValue: 0.34,
      }),
      criterion(id, {
        key: "move_in_capital",
        label: "Move-in capital",
        unit: "currency",
        direction: "at_least",
        greenThreshold: 450_000,
        yellowThreshold: 250_000,
        currentValue: 180_000,
        weight: 2,
      }),
      criterion(id, {
        key: "monthly_cash_flow",
        label: "Cash flow after rent",
        unit: "currency",
        direction: "at_least",
        greenThreshold: 80_000,
        yellowThreshold: 30_000,
        currentValue: 42_000,
      }),
    ],
  }),

  goal({
    id: "goal_supra",
    domain: "life",
    slug: "supra",
    title: "GR Supra",
    displayOrder: 3,
    criteria: (id) => [
      criterion(id, {
        key: "cash_reserves",
        label: "Cash reserves",
        unit: "currency",
        direction: "at_least",
        greenThreshold: 1_500_000,
        yellowThreshold: 800_000,
        currentValue: 620_000,
      }),
      criterion(id, {
        key: "down_payment",
        label: "Down payment",
        unit: "currency",
        direction: "at_least",
        greenThreshold: 1_000_000,
        yellowThreshold: 500_000,
        currentValue: 180_000,
        weight: 2,
      }),
      criterion(id, {
        key: "insurance_affordability",
        label: "Insurance affordability",
        unit: "currency",
        direction: "at_most",
        greenThreshold: 25_000,
        yellowThreshold: 40_000,
        currentValue: 61_000,
        blocking: true,
      }),
      criterion(id, {
        key: "debt_position",
        label: "Debt position",
        unit: "currency",
        direction: "at_most",
        greenThreshold: 0,
        yellowThreshold: 400_000,
        baselineValue: 1_400_000,
        currentValue: 940_000,
        weight: 2,
      }),
    ],
  }),

  goal({
    id: "goal_net_worth_100k",
    domain: "finance",
    slug: "net_worth_100k",
    title: "$100K net worth",
    displayOrder: 4,
    criteria: (id) => [
      criterion(id, {
        key: "net_worth",
        label: "Net worth",
        unit: "currency",
        direction: "at_least",
        greenThreshold: 10_000_000,
        yellowThreshold: 5_000_000,
        currentValue: 1_845_000,
        weight: 3,
      }),
      criterion(id, {
        key: "invested_assets",
        label: "Invested assets",
        unit: "currency",
        direction: "at_least",
        greenThreshold: 4_000_000,
        yellowThreshold: 1_500_000,
        currentValue: 0,
        weight: 2,
      }),
    ],
  }),

  goal({
    id: "goal_trading_edge",
    domain: "trading",
    slug: "trading_edge",
    title: "Demonstrated trading edge",
    description: "Enough evidence to trust the strategy with size.",
    displayOrder: 5,
    criteria: (id) => [
      criterion(id, {
        key: "dataset_size",
        label: "Journaled trades",
        unit: "count",
        direction: "at_least",
        greenThreshold: 200,
        yellowThreshold: 100,
        currentValue: 41,
        weight: 2,
        blocking: true,
      }),
      criterion(id, {
        key: "expectancy",
        label: "Expectancy (R)",
        unit: "ratio",
        direction: "at_least",
        greenThreshold: 0.3,
        yellowThreshold: 0.1,
        currentValue: 0.18,
        weight: 3,
      }),
      criterion(id, {
        key: "plan_adherence",
        label: "Plan adherence",
        unit: "percent",
        direction: "at_least",
        greenThreshold: 0.9,
        yellowThreshold: 0.7,
        currentValue: 0.68,
        weight: 2,
      }),
    ],
  }),

  goal({
    id: "goal_sentryops_pilot",
    domain: "sentryops",
    slug: "sentryops_pilot",
    title: "First SentryOps pilot",
    displayOrder: 6,
    criteria: (id) => [
      criterion(id, {
        key: "validated_problem",
        label: "Validated problem",
        unit: "percent",
        direction: "at_least",
        greenThreshold: 0.7,
        yellowThreshold: 0.4,
        currentValue: 0.28,
        weight: 3,
        blocking: true,
      }),
      criterion(id, {
        key: "product_readiness",
        label: "Product readiness",
        unit: "percent",
        direction: "at_least",
        greenThreshold: 0.8,
        yellowThreshold: 0.5,
        currentValue: 0.15,
        weight: 2,
      }),
      criterion(id, {
        key: "agency_conversations",
        label: "Agency conversations",
        unit: "count",
        direction: "at_least",
        greenThreshold: 10,
        yellowThreshold: 4,
        currentValue: 1,
      }),
    ],
  }),
];
