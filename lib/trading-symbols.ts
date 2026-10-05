/**
 * Symbol normalization shared by trades, bars and signals.
 *
 * TradingView and Tradovate spell the same market many ways (CME_MINI:NQ1!,
 * NQZ2026, MNQZ6). Micro and mini contracts track the same price, so learning
 * data is grouped by price family.
 */

const MONTH_CODES = "FGHJKMNQUVXZ";
const FAMILY: Record<string, string> = { MNQ: "NQ", MES: "ES", MYM: "YM", M2K: "RTY", MGC: "GC", MCL: "CL" };
const KNOWN_ROOTS = ["MNQ", "NQ", "MES", "ES", "MYM", "YM", "M2K", "RTY", "MGC", "GC", "MCL", "CL"];

export function symbolRoot(value: string | null | undefined): string | null {
  if (!value) return null;
  let s = value.toUpperCase().trim().replace(/^[A-Z0-9_]+:/, "").replace(/[^A-Z0-9!]/g, "");
  s = s.replace(/\d!$/, "");
  const known = KNOWN_ROOTS.find((root) => s.startsWith(root));
  if (known) return known;
  const contract = s.match(new RegExp(`^([A-Z0-9]+?)[${MONTH_CODES}]\\d{1,4}$`));
  return (contract ? contract[1] : s) || null;
}

export function priceFamily(value: string | null | undefined): string | null {
  const root = symbolRoot(value);
  return root ? FAMILY[root] ?? root : null;
}
