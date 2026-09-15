# DOMAIN: FINANCE

## Mission

Understand the complete financial system and direct capital from debt toward
independence — and eventually a multi-million-dollar net worth. Not expense
tracking; a financial operating system.

## The central idea: purpose, not balance

An account's **purpose** is a first-class field. A balance alone cannot tell
Jarvis whether $4,000 is an untouchable tax reserve, an emergency fund, or idle
cash that should be killing a 24% APR card.

```
BUSINESS CHECKING → business income / operating expenses
PERSONAL CHECKING → personal bills
HYSA              → emergency / reserves
TAX RESERVE       → taxes only, never touched
BROKERAGE         → long-term investing
TRADING           → risk capital
CREDIT CARDS      → liabilities / utilisation
```

Purpose is what makes allocation advice possible. Cash with no assigned purpose
drifts, which is why `unassignedCash` is a tracked metric and "assign a purpose
to these accounts" is a proposable move.

## Allocation

When money arrives, Jarvis proposes a split:

```
$2,000 received
  Taxes        $400
  Debt         $700
  Reserve      $400
  Investments  $300
  Operating    $200
```

Shares come from versioned, time-bounded `allocation_rules` tied to the user's
current **stage**:

```
DEBT → STABILITY → CASH RESERVES → STRONG CREDIT
     → CAPITAL → INVESTING → ASSET OWNERSHIP
     → $100K NET WORTH → $1M NET WORTH → MULTI-MILLION
```

Rules are versioned because the correct split changes with the stage, and past
advice must stay interpretable — "why did Jarvis say 35% to debt in March?"
should have an answer.

## Questions this must answer

Not emotionally. With the user's real numbers, in terms of goal impact:

- Can I move out?
- Can I afford this car?
- Should I pay this debt today or invest instead?
- Should I put more money into the business?
- How much should stay liquid?

The answer format is never "yes, the payment clears". It is *"buying now delays
$10K cash by six months and moves Move Out from YELLOW to RED"*.

## Capabilities

| Capability | Ceiling | Why |
| --- | --- | --- |
| `finance.read_accounts` | EXECUTE | Reading is safe |
| `finance.classify_transactions` | EXECUTE | Reversible, low stakes |
| `finance.recommend_allocation` | PREPARE | Proposes; never moves |
| `finance.move_money` | **PREPARE** | Never autonomous. Ever. |
| `finance.file_taxes` | **PREPARE** | Irreversible, legally binding |

## Rules

1. **Money is integer minor units.** Floating-point dollars are a correctness
   bug here, not a style preference.
2. **Business and personal stay separable** at the transaction level. Category
   and business-vs-personal are different fields — a meal can be either.
3. **Inferred classifications are marked as inferred** until the user confirms
   them.
4. **Tax reserve is not spendable capital** and is excluded from allocation
   availability.
5. **No estimate is presented as professional tax advice.**

## Planned schema

`financial_accounts`, `financial_transactions`, `debts`, `investments`,
`financial_snapshots`, `allocation_rules`. Specified in `docs/DATABASE.md`;
types in `src/domains/finance/types.ts`.

## Status in v0.1

Types, module contract and development data only. No bank, card or brokerage
connections; no transaction import; no tax calculation; no movement of money —
and `finance.move_money` is capped so that no configuration change can make it
autonomous.
