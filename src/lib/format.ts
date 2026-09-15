/**
 * Display formatting.
 *
 * Money is handled as a number of *minor units* (cents) everywhere it is
 * stored or computed — floating-point dollars accumulate error, and this system
 * is meant to reason about debt payoff and allocation down to the dollar.
 * Formatting to a human string happens here, at the very edge.
 */

export function formatCurrency(
  minorUnits: number,
  options: { currency?: string; compact?: boolean; showCents?: boolean } = {},
): string {
  const { currency = "USD", compact = false, showCents = false } = options;
  const major = minorUnits / 100;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: showCents ? 2 : 0,
    minimumFractionDigits: showCents ? 2 : 0,
  }).format(major);
}

export function formatPercent(fraction: number, digits = 0): string {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(fraction);
}

/** R multiple, the unit that actually matters in the trading domain. */
export function formatR(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}R`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
