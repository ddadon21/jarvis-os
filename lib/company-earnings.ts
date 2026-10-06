/**
 * LIFETIME EARNED — verified historical money produced by HJV revenue systems.
 * It is NOT current cash and NOT net worth (those come from Finance balances).
 *
 * Pure read-model: each source adapter turns its own records into
 * EarnedRecords; this module filters, de-duplicates and totals them. No number
 * is ever inferred from balance changes.
 *
 * Counting rules
 * - Only external inflows count (kind REVENUE). Transfers between Dwight's own
 *   accounts are kind TRANSFER and never count.
 * - Only settled records count (a payout must be PAID; approved, requested,
 *   denied or cancelled do not).
 * - The same real-world inflow can appear in two sources later (for example a
 *   prop-firm payout and the matching bank deposit). Sources share a
 *   dedupeKey for it and the higher-priority source wins, so it counts once.
 */

export type EarnedSourceId = "TRADING_PAYOUTS" | "LIVE_TRADING_WITHDRAWALS" | "SENTRYOPS_CONTRACTS" | "SOFTWARE_REVENUE" | "OTHER_REVENUE";

export type EarnedRecord = {
  /** Stable id inside its source table. */
  id: string;
  source: EarnedSourceId;
  kind: "REVENUE" | "TRANSFER";
  settled: boolean;
  amount: number;
  /** Who paid (firm, client, platform). */
  counterparty: string | null;
  occurredAt: string | null;
  /** Cross-source identity of the same real-world inflow, when known. */
  dedupeKey?: string | null;
  /** Provenance, e.g. "public.trading_payouts.payout_amount". */
  evidence: string;
};

export type EarnedSourceState = {
  source: EarnedSourceId;
  label: string;
  /** CONNECTED: records were read. UNAVAILABLE: reading failed. NOT_CONNECTED: no source exists yet. */
  status: "CONNECTED" | "UNAVAILABLE" | "NOT_CONNECTED";
  /** Lower number wins when two sources report the same inflow. */
  priority: number;
  records: EarnedRecord[];
  note?: string;
};

export type LifetimeEarned = {
  total: number | null;
  display: string;
  exact: string;
  coverage: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
  asOf: string;
  counted: Array<Pick<EarnedRecord, "id" | "source" | "amount" | "counterparty" | "occurredAt" | "evidence">>;
  excluded: { unsettled: number; transfers: number; duplicates: number; invalid: number };
  sources: Array<{ source: EarnedSourceId; label: string; status: EarnedSourceState["status"]; total: number; count: number; note?: string }>;
  definition: string;
};

export const LIFETIME_EARNED_DEFINITION =
  "Verified historical money produced by HJV revenue systems (settled external inflows). Not current cash, not net worth.";

export function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** $3,281.78 → "$3.3K"; $950 → "$950"; $1,250,000 → "$1.3M". */
export function formatCompactUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs < 1_000) return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
  if (abs < 1_000_000) {
    const thousands = Math.round(abs / 100) / 10;
    if (thousands >= 1_000) return `${sign}$1.0M`;
    return `${sign}$${thousands >= 100 ? Math.round(thousands) : thousands.toFixed(1)}K`;
  }
  const millions = Math.round(abs / 100_000) / 10;
  return `${sign}$${millions >= 100 ? Math.round(millions) : millions.toFixed(1)}M`;
}

export function formatExactUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function summarizeLifetimeEarned(sources: EarnedSourceState[], now = new Date()): LifetimeEarned {
  const excluded = { unsettled: 0, transfers: 0, duplicates: 0, invalid: 0 };
  const counted: LifetimeEarned["counted"] = [];
  const seenIds = new Set<string>();
  const seenDedupe = new Set<string>();
  const perSource = new Map<EarnedSourceId, { total: number; count: number }>();
  // Settled records whose amount could not be read: the source is not trustworthy as a total.
  const unreadable = new Map<EarnedSourceId, number>();

  for (const state of [...sources].sort((a, b) => a.priority - b.priority)) {
    if (state.status !== "CONNECTED") continue;
    for (const record of state.records) {
      if (!Number.isFinite(record.amount) || record.amount <= 0) {
        excluded.invalid++;
        if (record.settled && !Number.isFinite(record.amount)) unreadable.set(record.source, (unreadable.get(record.source) ?? 0) + 1);
        continue;
      }
      if (record.kind !== "REVENUE") { excluded.transfers++; continue; }
      if (!record.settled) { excluded.unsettled++; continue; }
      const identity = `${record.source}:${record.id}`;
      if (seenIds.has(identity) || (record.dedupeKey && seenDedupe.has(record.dedupeKey))) { excluded.duplicates++; continue; }
      seenIds.add(identity);
      if (record.dedupeKey) seenDedupe.add(record.dedupeKey);
      counted.push({ id: record.id, source: record.source, amount: roundCents(record.amount), counterparty: record.counterparty, occurredAt: record.occurredAt, evidence: record.evidence });
      const bucket = perSource.get(record.source) ?? { total: 0, count: 0 };
      bucket.total += record.amount;
      bucket.count += 1;
      perSource.set(record.source, bucket);
    }
  }

  // A source whose paid records have no readable amount is effectively unavailable, never $0.
  const effective = (state: EarnedSourceState): EarnedSourceState["status"] =>
    state.status === "CONNECTED" && (unreadable.get(state.source) ?? 0) > 0 && !perSource.has(state.source) ? "UNAVAILABLE" : state.status;
  const connected = sources.filter((state) => effective(state) === "CONNECTED");
  const unavailable = sources.filter((state) => effective(state) === "UNAVAILABLE" || (state.status === "CONNECTED" && (unreadable.get(state.source) ?? 0) > 0));
  // Not-yet-existing sources do not make the total partial; a failed read does.
  const coverage: LifetimeEarned["coverage"] = connected.length === 0 ? "UNAVAILABLE" : unavailable.length > 0 ? "PARTIAL" : "COMPLETE";
  const total = connected.length === 0 ? null : roundCents(counted.reduce((sum, record) => sum + record.amount, 0));

  return {
    total,
    display: formatCompactUsd(total),
    exact: formatExactUsd(total),
    coverage,
    asOf: now.toISOString(),
    counted: counted.sort((a, b) => Date.parse(b.occurredAt ?? "") - Date.parse(a.occurredAt ?? "") || 0),
    excluded,
    sources: sources.map((state) => {
      const missing = unreadable.get(state.source) ?? 0;
      const note = missing > 0 ? `${missing} paid record${missing === 1 ? "" : "s"} without a readable amount column.` : state.note;
      return {
        source: state.source,
        label: state.label,
        status: effective(state),
        total: roundCents(perSource.get(state.source)?.total ?? 0),
        count: perSource.get(state.source)?.count ?? 0,
        ...(note ? { note } : {}),
      };
    }),
    definition: LIFETIME_EARNED_DEFINITION,
  };
}

/* ---------------------------------------------------------------------- */
/* Adapter: public.trading_payouts                                         */
/* ---------------------------------------------------------------------- */

const AMOUNT_COLUMNS = ["payout_amount", "amount", "paid_amount", "amount_usd", "trader_net_amount", "net_amount", "gross_amount"] as const;
const DATE_COLUMNS = ["paid_at", "approved_at", "payout_date", "requested_at", "created_at"] as const;
const PARTY_COLUMNS = ["firm", "prop_firm", "provider", "platform"] as const;

function finiteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value.replace(/[$,]/g, "")) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Maps one trading_payouts row. The table predates the repo's migrations, so
 * columns are resolved by name and the column used is kept as evidence.
 * Only status PAID counts as settled.
 */
export function payoutRowToRecord(row: Record<string, unknown>): EarnedRecord | null {
  const id = row.id == null ? null : String(row.id);
  if (!id) return null;
  const amountColumn = AMOUNT_COLUMNS.find((column) => finiteNumber(row[column]) != null);
  const amount = amountColumn ? finiteNumber(row[amountColumn])! : Number.NaN;
  const dateColumn = DATE_COLUMNS.find((column) => typeof row[column] === "string" && Number.isFinite(Date.parse(row[column] as string)));
  const partyColumn = PARTY_COLUMNS.find((column) => typeof row[column] === "string" && (row[column] as string).trim() !== "");
  const status = typeof row.status === "string" ? row.status.trim().toUpperCase() : "";
  return {
    id,
    source: "TRADING_PAYOUTS",
    kind: "REVENUE",
    settled: status === "PAID",
    amount,
    counterparty: partyColumn ? String(row[partyColumn]).trim() : null,
    occurredAt: dateColumn ? new Date(row[dateColumn] as string).toISOString() : null,
    evidence: `public.trading_payouts.${amountColumn ?? "?"}${status ? ` · status ${status}` : " · no status"}`,
  };
}

/** Sources that will feed the metric later; listed so the coverage is explicit. */
export const FUTURE_EARNED_SOURCES: EarnedSourceState[] = [
  { source: "LIVE_TRADING_WITHDRAWALS", label: "Live trading withdrawals", status: "NOT_CONNECTED", priority: 20, records: [], note: "No live brokerage withdrawals are recorded in Jarvis yet." },
  { source: "SENTRYOPS_CONTRACTS", label: "SentryOps contract revenue", status: "NOT_CONNECTED", priority: 30, records: [], note: "No SentryOps contracts recorded yet." },
  { source: "SOFTWARE_REVENUE", label: "Software / subscription revenue", status: "NOT_CONNECTED", priority: 40, records: [], note: "No software revenue source connected yet." },
  { source: "OTHER_REVENUE", label: "Other HJV revenue", status: "NOT_CONNECTED", priority: 50, records: [], note: "No other revenue source connected yet." },
];
