# DOMAIN: TRADING

## Mission

Learn how the user **actually** trades — not how they describe their strategy —
and turn that into structured evidence. Then find the real edge, improve the
strategy and indicator, and eventually develop a model that trades like the
user and statistically better.

The posture is a researcher's, not a trader's. Nothing in this domain places an
order.

## Evolution

```
Observer → Journal → Analytics → Strategy Scientist
        → Shadow Trader → Paper Trader → controlled live system
```

Each stage is gated on the previous one producing enough evidence to justify it.
Autonomous live trading is **out of scope** and its capability is capped below
EXECUTE in code (`trading.live_order`, `hardCeiling: "prepare"`).

## The dataset is the product

A trade row without its context can never answer "under what conditions does
this setup actually work?". The target record set:

**Identity** — account, broker/platform, mode (live/paper/sim/backtest),
instrument, direction.

**Execution** — entry, exit, stop loss, targets, contracts/size, fees,
timestamps per fill.

**Result** — P&L, R multiple, MAE/MFE, risk amount at entry.

**Time** — session (Asia / London / NY AM / NY PM / overnight), day of week.

**Context** — HTF bias, zones, liquidity levels, sweeps, gaps and inverse gaps,
news events in the window.

**Signal** — indicator events, indicator version, signal strength, and whether
the signal was traded.

**Behaviour** — setup classification, the user's reasoning in their own words,
whether the plan was followed, and each deviation.

**Aftermath** — what price did after the exit, screenshots/chart snapshots.

**The control group** — skipped setups (signal fired, not taken, and why) and
unsignalled entries (trade taken with no signal). Both are as important as the
trades themselves. A dataset containing only taken trades can measure
performance but cannot measure *selection*, which is where most of the edge and
most of the leak live.

## Questions this must eventually answer

- Under which conditions does the user perform best?
- Which specific behaviour precedes the worst losses?
- Which combination of indicator conditions is genuinely strongest?
- Which self-declared "A+" setup has weak measured expectancy?
- What would a disciplined version of this trader have earned over the same
  period?

## Rules

1. **Sample size gates conclusions.** Below roughly 100 trades, per-setup
   expectancy is noise. The Strategy Scientist states this rather than
   producing a confident number from 30 samples.
2. **Live and paper are never mixed** in analysis.
3. **Trade records are corrected by appending**, never by editing. A journal
   that can be quietly revised is not evidence.
4. **Plan adherence is the highest-signal behavioural metric** in the dataset
   and is tracked on every trade.
5. **Hypotheses are falsifiable.** A claim about the user's edge must state
   what would prove it wrong.

## Agents

- **Trading Intelligence** — observes and journals. Highest autonomy in this
  domain (EXECUTE on journaling), zero on ordering.
- **Trading Risk** — tracks exposure and drawdown against the user's own stated
  limits. RECOMMEND only.
- **Strategy Scientist** — forms and tests hypotheses. RECOMMEND only.

Full surfaces in `docs/AGENTS.md`.

## Planned schema

`trading_accounts`, `trades`, `trade_executions`, `trade_setups`,
`market_context`, `indicator_events`, `skipped_setups`, `strategy_versions`.
Columns are specified in `docs/DATABASE.md`. Types exist now in
`src/domains/trading/types.ts`; tables are intentionally **not** migrated until
there is a real feed to shape them against.

## Status in v0.1

Types, module contract and development data only. No platform connection, no
automatic capture, no analysis. `TradingModule.proposeMoves` currently surfaces
dataset gaps — journal backlog, sample size, plan-adherence review — because
that is genuinely the highest-value trading work available before a feed exists.
