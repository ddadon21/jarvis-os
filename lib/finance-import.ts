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
      "current": 0,
      "available": 0,
      "limit": 0,
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
      "current": 0,
      "available": 0,
      "limit": 0,
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
      "current": 0,
      "available": 0,
      "limit": 0,
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
      "current": 0,
      "available": 0,
      "limit": 0,
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
      "current": 0,
      "available": 0,
      "limit": 0,
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
      "current": 0,
      "available": 0,
      "limit": 0,
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
      "current": 0,
      "available": 0,
      "limit": 0,
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
      "current": 0,
      "available": 0,
      "limit": 0,
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
      "current": 0,
      "available": 0,
      "limit": 0,
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
      "current": 0,
      "available": 0,
      "limit": 0,
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
      "current": 0,
      "available": 0,
      "limit": 0,
      "balanceUpdatedAt": "2026-10-04T23:34:24.233747Z",
      "balanceAsOf": null,
      "balanceFreshness": "unknown"
    }
  ],
  "liabilities": [
    {
      "accountKey": "rbfcu-world",
      "apr": 0,
      "minimum": 0,
      "due": "2026-09-21",
      "statementDate": "2026-08-24",
      "lastPaymentDate": "2026-08-13",
      "isOverdue": false
    },
    {
      "accountKey": "rbfcu-platinum",
      "apr": 0,
      "minimum": 0,
      "due": "2026-10-04",
      "statementDate": "2026-09-07",
      "lastPaymentDate": "2026-09-13",
      "isOverdue": false
    },
    {
      "accountKey": "capitalone-quicksilver",
      "apr": 0,
      "minimum": 0,
      "due": "2026-10-14",
      "statementDate": "2026-09-19",
      "lastPaymentDate": "2026-08-12",
      "isOverdue": false
    }
  ],
  "mode": "SYNCED_SNAPSHOT",
  "source": "CHATGPT FINANCES · REFRESHED SNAPSHOT",
  "asOf": "2026-11-09T12:00:00.000Z",
  "connectionCount": 7,
  "transactionHistory": "FULL HISTORY IN CHATGPT; NOT IMPORTED",
  "recurringHistory": "FULL HISTORY IN CHATGPT; NOT IMPORTED",
  "note": "All finance figures reset to $0."
} satisfies {
 accounts: FinanceAccountState[]; liabilities: FinanceLiabilityState[];
 mode: "SYNCED_SNAPSHOT"; source: string; asOf: string; connectionCount: number;
 transactionHistory: string; recurringHistory: string; note: string;
};

