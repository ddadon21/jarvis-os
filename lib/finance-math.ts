import type { FinanceAccountState } from "./jarvis-runtime";

export const cents = (value: number) => Math.round((value + Number.EPSILON) * 100);
export function financeTotals(accounts: FinanceAccountState[]) {
  const banks = accounts.filter(a => a.type === "depository");
  const sum = (items: FinanceAccountState[], field: "current" | "available" = "current") => items.reduce((n, a) => n + cents(a[field] ?? 0), 0) / 100;
  const debts = accounts.filter(a => a.type === "credit" || a.type === "loan");
  const debtSum = (items: FinanceAccountState[]) => items.reduce((n, a) => n + cents(Math.max(0, a.current)), 0) / 100;
  const liquidity = sum(banks);
  const investmentValue = sum(accounts.filter(a => a.type === "investment"));
  const personalDebt = debtSum(debts.filter(a => a.ownership !== "AUTHORIZED_USER"));
  const authorizedUserBalance = debtSum(debts.filter(a => a.ownership === "AUTHORIZED_USER"));
  const personalNetWorth = (cents(liquidity) + cents(investmentValue) - cents(personalDebt)) / 100;
  const missingAvailable = banks.filter(a => a.available == null).length;
  return {
    liquidity, investmentValue, personalDebt, authorizedUserBalance, personalNetWorth,
    providerNetWorth: (cents(personalNetWorth) - cents(authorizedUserBalance)) / 100,
    availableCash: banks.length && !missingAvailable ? sum(banks, "available") : null,
    knownAvailableCash: sum(banks, "available"), missingAvailable,
    personalCash: sum(banks.filter(a => a.ownership === "PERSONAL")),
    businessCash: sum(banks.filter(a => a.ownership === "BUSINESS")),
  };
}

export type PayoutPlan = { payout: string; tax: string; bills: string; reserve: string; debt: string; business: string; target: string };
export const EMPTY_PAYOUT_PLAN: PayoutPlan = { payout: "", tax: "", bills: "", reserve: "", debt: "", business: "", target: "" };
export const PLAN_FIELDS = ["tax", "bills", "reserve", "debt", "business"] as const;
export function payoutMath(plan: PayoutPlan, targetBalance: number | null) {
  const fields = ["payout", ...PLAN_FIELDS] as const;
  const invalid = fields.some(k => plan[k].trim() !== "" && (!/^\d+(\.\d{0,2})?$/.test(plan[k]) || !Number.isFinite(Number(plan[k])) || Number(plan[k]) > 1_000_000_000));
  const value = (key: typeof fields[number]) => cents(Number(plan[key]) || 0);
  const total = value("payout");
  const assigned = PLAN_FIELDS.reduce((n, key) => n + value(key), 0);
  const debt = value("debt");
  const error = invalid ? "Use nonnegative amounts with up to two decimal places."
    : total <= 0 ? "Enter the net payout you want to plan."
    : assigned > total ? "Assignments exceed the payout. Reduce an amount before saving."
    : debt > 0 && targetBalance == null ? "Choose a personal debt target."
    : debt > cents(targetBalance ?? 0) ? "The debt assignment exceeds the reported balance."
    : null;
  return { payout: total / 100, assigned: assigned / 100, remaining: (total - assigned) / 100,
    projectedDebt: targetBalance == null ? null : Math.max(0, cents(targetBalance) - debt) / 100, error };
}
