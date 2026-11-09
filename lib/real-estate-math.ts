// Fix-and-flip deal math and criteria checks for the Real Estate page.
// All inputs are strings from form fields so empty means "not set", never 0.

export const PROPERTY_TYPES = ["SINGLE FAMILY", "TOWNHOUSE", "CONDO", "MULTI 2-4"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export type DealCriteria = {
  areas: string;
  propertyTypes: PropertyType[];
  minPrice: string;
  maxPrice: string;
  minBeds: string;
  minBaths: string;
  minSqft: string;
  minYearBuilt: string;
  maxRehab: string;
  minProfit: string;
  minRoi: string;
  maxArvPercent: string;
  maxDaysOnMarket: string;
  notes: string;
};

export const EMPTY_CRITERIA: DealCriteria = {
  areas: "", propertyTypes: [], minPrice: "", maxPrice: "", minBeds: "", minBaths: "", minSqft: "",
  minYearBuilt: "", maxRehab: "", minProfit: "", minRoi: "", maxArvPercent: "", maxDaysOnMarket: "", notes: "",
};

export type DealInput = {
  address: string;
  area: string;
  propertyType: PropertyType | "";
  purchasePrice: string;
  arv: string;
  rehab: string;
  beds: string;
  baths: string;
  sqft: string;
  yearBuilt: string;
  daysOnMarket: string;
  holdingMonths: string;
  monthlyHolding: string;
  buyClosingPercent: string;
  sellCostPercent: string;
  financingCost: string;
};

export const EMPTY_DEAL: DealInput = {
  address: "", area: "", propertyType: "", purchasePrice: "", arv: "", rehab: "", beds: "", baths: "", sqft: "",
  yearBuilt: "", daysOnMarket: "", holdingMonths: "", monthlyHolding: "", buyClosingPercent: "2", sellCostPercent: "8", financingCost: "",
};

export const DEAL_STAGES = ["NEW", "ANALYZING", "OFFER SENT", "UNDER CONTRACT", "PASSED"] as const;
export type DealStage = (typeof DEAL_STAGES)[number];
export type SavedDeal = DealInput & { id: string; stage: DealStage; savedAt: string };

/** Parses a form value; blank or invalid input is null ("not set"). */
export function num(value: string | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const n = Number(value.replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type DealResult = {
  ready: boolean;
  missing: string[];
  buyClosing: number;
  holding: number;
  sellCosts: number;
  totalCost: number;
  cashInvested: number;
  profit: number;
  roi: number | null;
  arvPercent: number | null;
  maxOffer: number | null;
};

/**
 * Profit = ARV − purchase − rehab − buy closing − holding − selling costs − financing.
 * ROI is profit over everything put in before the sale (all costs except selling costs).
 * Max offer uses the criteria's max % of ARV (the "70% rule" when set to 70): ARV × % − rehab.
 */
export function analyzeDeal(deal: DealInput, maxArvPercent: number | null = null): DealResult {
  const purchase = num(deal.purchasePrice);
  const arv = num(deal.arv);
  const rehab = num(deal.rehab);
  const missing = [purchase == null ? "purchase price" : null, arv == null ? "ARV" : null, rehab == null ? "rehab" : null].filter((m): m is string => m != null);
  const p = purchase ?? 0, a = arv ?? 0, r = rehab ?? 0;
  const buyClosing = cents(p * (num(deal.buyClosingPercent) ?? 0) / 100);
  const holding = cents((num(deal.holdingMonths) ?? 0) * (num(deal.monthlyHolding) ?? 0));
  const sellCosts = cents(a * (num(deal.sellCostPercent) ?? 0) / 100);
  const financing = num(deal.financingCost) ?? 0;
  const cashInvested = cents(p + r + buyClosing + holding + financing);
  const totalCost = cents(cashInvested + sellCosts);
  const profit = cents(a - totalCost);
  return {
    ready: missing.length === 0,
    missing,
    buyClosing, holding, sellCosts, totalCost, cashInvested, profit,
    roi: cashInvested > 0 ? cents(profit / cashInvested * 100) : null,
    arvPercent: a > 0 ? cents((p + r) / a * 100) : null,
    maxOffer: maxArvPercent != null && arv != null ? cents(a * maxArvPercent / 100 - r) : null,
  };
}

export type CriteriaCheck = { label: string; pass: boolean | null; detail: string };

const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** Checks a deal against every criterion that is set. pass=null means the deal is missing that data. */
export function checkCriteria(deal: DealInput, criteria: DealCriteria, result = analyzeDeal(deal, num(criteria.maxArvPercent))): CriteriaCheck[] {
  const checks: CriteriaCheck[] = [];
  const areas = criteria.areas.split(/[,\n;]/).map(a => a.trim().toLowerCase()).filter(Boolean);
  if (areas.length) {
    const where = `${deal.area} ${deal.address}`.toLowerCase();
    checks.push({ label: "TARGET AREA", pass: where.trim() ? areas.some(a => where.includes(a)) : null, detail: deal.area || "Area not entered" });
  }
  if (criteria.propertyTypes.length) {
    checks.push({ label: "PROPERTY TYPE", pass: deal.propertyType ? criteria.propertyTypes.includes(deal.propertyType) : null, detail: deal.propertyType || "Type not entered" });
  }
  const range = (label: string, value: number | null, min: number | null, max: number | null, fmt: (n: number) => string = String) => {
    if (min == null && max == null) return;
    const bounds = [min != null ? `min ${fmt(min)}` : null, max != null ? `max ${fmt(max)}` : null].filter(Boolean).join(" · ");
    checks.push({ label, pass: value == null ? null : (min == null || value >= min) && (max == null || value <= max), detail: value == null ? `Not entered · ${bounds}` : `${fmt(value)} · ${bounds}` });
  };
  range("PRICE", num(deal.purchasePrice), num(criteria.minPrice), num(criteria.maxPrice), money);
  range("BEDS", num(deal.beds), num(criteria.minBeds), null);
  range("BATHS", num(deal.baths), num(criteria.minBaths), null);
  range("SQFT", num(deal.sqft), num(criteria.minSqft), null, n => n.toLocaleString("en-US"));
  range("YEAR BUILT", num(deal.yearBuilt), num(criteria.minYearBuilt), null);
  range("DAYS ON MARKET", num(deal.daysOnMarket), null, num(criteria.maxDaysOnMarket));
  range("REHAB", num(deal.rehab), null, num(criteria.maxRehab), money);
  range("PROFIT", result.ready ? result.profit : null, num(criteria.minProfit), null, money);
  range("ROI %", result.ready ? result.roi : null, num(criteria.minRoi), null, n => `${n}%`);
  range("% OF ARV", result.ready ? result.arvPercent : null, null, num(criteria.maxArvPercent), n => `${n}%`);
  return checks;
}

export function criteriaSetCount(criteria: DealCriteria) {
  return (Object.keys(criteria) as (keyof DealCriteria)[])
    .filter(k => k !== "notes")
    .filter(k => Array.isArray(criteria[k]) ? (criteria[k] as unknown[]).length > 0 : String(criteria[k]).trim() !== "").length;
}

/** "PASS" only when every set criterion passes; "UNKNOWN" when any is missing data. */
export function verdict(checks: CriteriaCheck[]): "PASS" | "FAIL" | "UNKNOWN" | "NO CRITERIA" {
  if (!checks.length) return "NO CRITERIA";
  if (checks.some(c => c.pass === false)) return "FAIL";
  if (checks.some(c => c.pass == null)) return "UNKNOWN";
  return "PASS";
}
