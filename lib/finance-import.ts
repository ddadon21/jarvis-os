import type { FinanceAccountState, FinanceLiabilityState } from "./jarvis-runtime";

// Refresh receipt time is distinct from the bank balance effective time.
// No provider IDs, credentials, or account numbers are stored here.
export const FINANCE_IMPORT = {
  "accounts": [
    {
      "key": "chase-checking",
      "institution": "CHASE",
      "name": "CHASE SECURE BANKING",
      "type": "depository",
      "subtype": "checking",
      "ownership": "PERSONAL",
      "role": "PERSONAL CONTROL",
      "current": 2.3,
      "available": 2.3,
      "limit": null,
      "balanceUpdatedAt": "2026-10-05T04:49:43.194637Z",
      "balanceAsOf": null,
      "balanceFreshness": "unknown"
    },
    {
      "key": "bofa-personal",
      "institution": "BANK OF AMERICA",
      "name": "ADV SAFEBALANCE BANKING",
      "type": "depository",
      "subtype": "checking",
      "ownership": "PERSONAL",
      "role": "TEMPORARY SUBSCRIPTIONS",
      "current": 14.49,
      "available": 9.49,
      "limit": null,
      "balanceUpdatedAt": "2026-10-05T04:49:43.413789Z",
      "balanceAsOf": null,
      "balanceFreshness": "unknown"
    },
    {
      "key": "bofa-business",
      "institution": "BANK OF AMERICA",
      "name": "BUSINESS ADV FUNDAMENTALS",
      "type": "depository",
      "subtype": "checking",
      "ownership": "BUSINESS",
      "role": "CAPITAL GENERATION",
      "current": -11.26,
      "available": -11.26,
      "limit": null,
      "balanceUpdatedAt": "2026-10-05T04:49:43.512590Z",
      "balanceAsOf": null,
      "balanceFreshness": "unknown"
    },
    {
      "key": "schwab-checking",
      "institution": "CHARLES SCHWAB",
      "name": "INVESTOR CHECKING",
      "type": "depository",
      "subtype": "checking",
      "ownership": "PERSONAL",
      "role": "INVESTMENT ROUTING",
      "current": 0.93,
      "available": 0.93,
      "limit": null,
      "balanceUpdatedAt": "2026-10-04T13:28:17.245721Z",
      "balanceAsOf": null,
      "balanceFreshness": "unknown"
    },
    {
      "key": "schwab-brokerage",
      "institution": "CHARLES SCHWAB",
      "name": "INDIVIDUAL",
      "type": "investment",
      "subtype": "brokerage",
      "ownership": "PERSONAL",
      "role": "COMPOUNDING",
      "current": 1.78,
      "available": 1.78,
      "limit": null,
      "balanceUpdatedAt": "2026-10-04T13:28:17.245721Z",
      "balanceAsOf": null,
      "balanceFreshness": "unknown"
    },
    {
      "key": "amex-hysa",
      "institution": "AMERICAN EXPRESS",
      "name": "HIGH YIELD SAVINGS ACCOUNT",
      "type": "depository",
      "subtype": "savings",
      "ownership": "PERSONAL",
      "role": "LIQUIDITY / RESERVE",
      "current": 0.76,
      "available": 0.76,
      "limit": null,
      "balanceUpdatedAt": "2026-10-04T12:21:08.621635Z",
      "balanceAsOf": null,
      "balanceFreshness": "unknown"
    },
    {
      "key": "rbfcu-checking",
      "institution": "RBFCU",
      "name": "CHECKING CHECKING",
      "type": "depository",
      "subtype": "checking",
      "ownership": "PERSONAL",
      "role": "LIFESTYLE",
      "current": 7.43,
      "available": 7.43,
      "limit": null,
      "balanceUpdatedAt": "2026-10-05T04:49:44.484169Z",
      "balanceAsOf": null,
      "balanceFreshness": "unknown"
    },
    {
      "key": "rbfcu-savings",
      "institution": "RBFCU",
      "name": "PRIMARY SAVINGS SAVINGS",
      "type": "depository",
      "subtype": "savings",
      "ownership": "PERSONAL",
      "role": "CASH RESERVE",
      "current": 3.99,
      "available": 2.99,
      "limit": null,
      "balanceUpdatedAt": "2026-10-04T16:29:37.119176Z",
      "balanceAsOf": null,
      "balanceFreshness": "unknown"
    },
    {
      "key": "rbfcu-platinum",
      "institution": "RBFCU",
      "name": "PLATINUM PREMIER",
      "type": "credit",
      "subtype": "credit card",
      "ownership": "AUTHORIZED_USER",
      "role": "CREDIT CONTEXT",
      "current": 8332.66,
      "available": 4153,
      "limit": 12500,
      "balanceUpdatedAt": "2026-10-05T04:49:44.484169Z",
      "balanceAsOf": null,
      "balanceFreshness": "unknown"
    },
    {
      "key": "rbfcu-world",
      "institution": "RBFCU",
      "name": "WORLD CARD",
      "type": "credit",
      "subtype": "credit card",
      "ownership": "PERSONAL",
      "role": "LIABILITY",
      "current": 592.14,
      "available": 7,
      "limit": 600,
      "balanceUpdatedAt": "2026-10-04T16:29:37.119176Z",
      "balanceAsOf": null,
      "balanceFreshness": "unknown"
    },
    {
      "key": "capitalone-quicksilver",
      "institution": "CAPITAL ONE",
      "name": "QUICKSILVER",
      "type": "credit",
      "subtype": "credit card",
      "ownership": "PERSONAL",
      "role": "LIABILITY",
      "current": 540.19,
      "available": null,
      "limit": null,
      "balanceUpdatedAt": "2026-10-04T23:34:24.233747Z",
      "balanceAsOf": null,
      "balanceFreshness": "unknown"
    }
  ],
  "liabilities": [
    {
      "accountKey": "rbfcu-world",
      "apr": 18,
      "minimum": 25,
      "due": "2026-09-21",
      "statementDate": "2026-08-24",
      "lastPaymentDate": "2026-08-13",
      "isOverdue": false
    },
    {
      "accountKey": "rbfcu-platinum",
      "apr": 11.2,
      "minimum": 0,
      "due": "2026-10-04",
      "statementDate": "2026-09-07",
      "lastPaymentDate": "2026-09-13",
      "isOverdue": false
    },
    {
      "accountKey": "capitalone-quicksilver",
      "apr": null,
      "minimum": 67,
      "due": "2026-10-14",
      "statementDate": "2026-09-19",
      "lastPaymentDate": "2026-08-12",
      "isOverdue": false
    }
  ],
  "mode": "SYNCED_SNAPSHOT",
  "source": "CHATGPT FINANCES · REFRESHED SNAPSHOT",
  "asOf": "2026-10-05T04:49:48.938Z",
  "connectionCount": 7,
  "transactionHistory": "FULL HISTORY IN CHATGPT; NOT IMPORTED",
  "recurringHistory": "FULL HISTORY IN CHATGPT; NOT IMPORTED",
  "note": "Refresh requested for all 7 connections on Oct 5. Snapshot uses the latest provider-returned balances re-read after that request; provider effective balance times remain unconfirmed, and several connections reported partial account coverage immediately after the refresh request. Platinum Premier remains AUTHORIZED_USER and is excluded from personal debt. Capital One Platinum and Roth IRA are absent from this connected account set; no balance assumed."
} satisfies {
 accounts: FinanceAccountState[]; liabilities: FinanceLiabilityState[];
 mode: "SYNCED_SNAPSHOT"; source: string; asOf: string; connectionCount: number;
 transactionHistory: string; recurringHistory: string; note: string;
};

