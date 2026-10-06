# Revenue and money-flow metrics

How Jarvis counts money over time. Balances (current cash, debt, net worth) are a
different thing and come from Finance account balances.

## LIFETIME EARNED
Verified historical money produced by HJV revenue systems. **Not current cash, not net worth.**

- Code: `lib/company-earnings.ts` (pure read-model) and `lib/company-earnings-store.ts` (source adapters). API: `GET /api/company/earnings`.
- Shown as a compact header stat on the Workforce page (exact amount, records and sources on click) and as VERIFIED LIFETIME EARNED on Finance.
- Counts only **settled external inflows** (`kind: REVENUE`, `settled: true`). Approved, requested, denied or cancelled payouts do not count.
- Transfers between Dwight's own accounts are `kind: TRANSFER` and never count.
- The same real-world inflow seen by two sources (for example a prop-firm payout and the matching bank deposit) carries a shared `dedupeKey`; the higher-priority source keeps it, so it counts once.
- A source that cannot be read is UNAVAILABLE; the total is never shown as $0 for missing data.

| Source | Status today |
| --- | --- |
| Prop-firm trading payouts — `public.trading_payouts`, status PAID | Connected |
| Live trading withdrawals | Not connected |
| SentryOps contract revenue | Not connected |
| Software / subscription revenue | Not connected |
| Other HJV revenue | Not connected |

Adding a source = one adapter that returns `EarnedRecord`s plus an entry in the source list. No new table is needed until the source itself exists.

## Historical flows (Finance)
Shown as NOT TRACKED YET / coverage unavailable until transaction history is imported:

- **Tracked spending / outflows**
- **Trading realized losses** (shown separately from lifestyle and business spending)
- **Interest + fees** (shown separately)

Rules for when transactions are ingested:
1. Count each purchase once.
2. Exclude internal transfers.
3. Net attributable refunds against the purchase they refund.
4. A credit-card payment is not new spending when the card purchase was already counted.
5. Interest and fees are their own line.
6. Trading realized losses are their own line.
7. Debt outstanding is a balance, not a spending total.
8. No number is ever inferred from changes in account balances.
