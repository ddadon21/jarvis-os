# DATABASE

Supabase Postgres. Migrations in `supabase/migrations/`.

## Conventions

- Every user-owned table has `user_id uuid not null references auth.users (id)
  on delete cascade`.
- Timestamps are `timestamptz`, always UTC.
- **Money is `bigint` in minor units (cents).** Never `numeric` dollars, never
  `float`.
- Enums are Postgres types, so the database rejects nonsense rather than
  trusting the application to. They mirror `src/core/types.ts` and must be
  changed together with it.
- Row-level security is enabled on every table, deny by default. See
  `docs/SECURITY.md`.

## Migrated in v0.1 — core only

`20260315000001_core_schema.sql` and `20260315000002_core_rls.sql`.

| Table | Purpose |
| --- | --- |
| `profiles` | One row per auth user. Created by trigger on signup. |
| `goals` | Major objectives, one per domain-scoped slug. |
| `goal_criteria` | The measurable conditions behind a goal. |
| `goal_criterion_readings` | Append-only measurement history. |
| `tasks` | Work items. Carries `move_factors` for scoring. |
| `events` | Append-only ledger. Immutable except processing state. |
| `world_state_snapshots` | Point-in-time structured state. |
| `agent_states` | Per-agent runtime state and resume cursor. |
| `memories` | Working / domain / episodic / document memory. |
| `notifications` | One row per routed channel. |
| `approval_requests` | PREPARE → EXECUTE consent records. |
| `permission_grants` | Per-capability autonomy, clamped by code ceilings. |
| `audit_log` | Append-only. No update or delete policy, ever. |

### Decisions worth knowing

**Readiness is not stored.** `goals` has no `readiness` column. It is computed
from criteria on read, because criterion values move for reasons no single
write path controls and a cached verdict would be stale more often than right.

**`tasks` has no `priority` column.** Ranking is the Next Move Engine's job and
is computed from many factors. A hand-set priority field would compete with it
and always win, because it is easier to set.

**Threshold ordering is a check constraint.** `yellow_threshold` must sit
between red and green in the direction of improvement, or the three-state
rollup is meaningless.

**Three tables are append-only:** `events` (except `processing_status` /
`processed_at`), `audit_log`, and `goal_criterion_readings`. Editing a past
measurement would silently rewrite a goal's history.

## Planned — domain schemas, NOT yet migrated

These are specified so the vocabulary is fixed, and deliberately not created.
A `trades` table designed in the abstract will be wrong in ways that are
expensive to discover after a year of rows; it should be written against a real
broker feed. TypeScript types already exist in `src/domains/*/types.ts`.

### Trading

```
trading_accounts
  id, user_id, label, platform, broker, mode(live|paper|sim|backtest),
  currency, starting_balance, current_balance, active

trades
  id, user_id, account_id → trading_accounts, instrument,
  direction(long|short), status(open|closed|cancelled),
  entry_price, exit_price, stop_loss, targets[], quantity,
  risk_amount, realized_pnl, r_multiple, mae, mfe,
  opened_at, closed_at, session, day_of_week,
  setup_id → trade_setups, market_context_id → market_context,
  reasoning, followed_plan, plan_deviations[], screenshot_paths[],
  post_trade_notes, external_id

trade_executions          -- individual fills; a trade has one or more
  id, trade_id → trades, side(buy|sell), quantity, price,
  executed_at, fees, external_id

trade_setups
  id, user_id, key, name, description, user_grade, rules_version

market_context            -- captured whether or not a trade was taken
  id, user_id, instrument, observed_at, session, day_of_week,
  htf_bias, zones[], liquidity_levels[], swept_levels[],
  gaps[], inverse_gaps[], news_events[], notes

indicator_events
  id, user_id, instrument, indicator_version, signal_type, fired_at,
  direction, strength, trade_id → trades (nullable — null is meaningful),
  payload jsonb

skipped_setups            -- the control group
  id, user_id, instrument, observed_at, setup_id, reason,
  market_context_id, hypothetical_r_multiple

strategy_versions
  id, user_id, version, rules jsonb, effective_from, effective_until,
  evidence_summary, superseded_by_id
```

Indexes to plan for: `trades (user_id, opened_at desc)`,
`trades (user_id, setup_id, session)` — the expectancy-by-condition query is
the one that will run constantly.

### Finance

```
financial_accounts
  id, user_id, label, institution, kind, purpose, currency,
  balance, is_liability, credit_limit, interest_rate_bps,
  last_synced_at, active, external_id

financial_transactions
  id, user_id, account_id → financial_accounts, posted_at, amount,
  direction(inflow|outflow|transfer), description, merchant, category,
  is_business, classification_inferred,
  counterparty_account_id → financial_accounts, external_id

debts
  id, user_id, account_id, label, original_balance, current_balance,
  interest_rate_bps, minimum_payment, due_day_of_month, payoff_priority

investments
  id, user_id, account_id, symbol, quantity, cost_basis, market_value, as_of

financial_snapshots
  id, user_id, captured_at, total_assets, total_liabilities, net_worth,
  liquid_cash, monthly_income, monthly_expenses, credit_utilization

allocation_rules
  id, user_id, stage, purpose, share, floor_amount, cap_amount,
  effective_from, effective_until, rationale
```

Note `purpose` on `financial_accounts` — it is what makes allocation advice
possible, and it is not optional. `allocation_rules` are versioned and
time-bounded so past advice stays interpretable.

### SentryOps

```
agencies
  id, user_id, name, type, state, county, population, sworn_officers,
  annual_budget, known_systems[], website_url, notes

agency_observations       -- always user_observation; never promoted in place
  id, user_id, agency_id, observed_at, title, detail, process_area,
  perceived_pain, evidence_kind, validation_ids[]

vendors
  id, user_id, name, website_url, product_areas[], known_customers[], notes

competitors
  id, user_id, vendor_id, name, positioning, strengths[], weaknesses[],
  pricing_notes, last_reviewed_at

contracts
  id, user_id, agency_id, vendor_id, title, value, start_date, end_date,
  renewal_date, procurement_route, source_id → research_sources

rfps
  id, user_id, agency_id, title, status, posted_at, due_at,
  estimated_value, requirements[], source_id → research_sources

research_sources
  id, user_id, url, title, publisher, retrieved_at, evidence_kind, excerpt

product_hypotheses
  id, user_id, statement, stage, status, falsification_condition, confidence,
  supporting_observation_ids[], supporting_source_ids[],
  contradicting_source_ids[], market_frequency jsonb,
  estimated_buyer, created_at, updated_at

opportunities
  id, user_id, hypothesis_id, title, target_segment,
  estimated_contract_value, competitive_gap, confidence
```

`evidence_kind` is required on every claim-bearing row. `contracts.source_id`
and `rfps.source_id` are **not nullable** — a contract without a source is a
rumour.

### Life

```
commitments
  id, user_id, title, kind, starts_at, ends_at, location,
  financial_impact, notes, external_calendar_id

major_decisions
  id, user_id, title, kind, goal_slug → goals.slug, estimated_cost,
  estimated_monthly_cost, target_date, notes
```

## Ownership and security

Single-user-per-row throughout. No shared or organisational ownership, no
soft-delete columns, no cross-user visibility. If Jarvis ever gains a second
user, ownership becomes a real design question — today, pretending otherwise
would be speculative complexity.

RLS policies are in the second migration. Every table is owner-only via
`auth.uid() = user_id`, with three narrower cases documented there.

## Generated types

Once a Supabase project exists:

```bash
npx supabase gen types typescript --project-id <id> > src/server/supabase/database.types.ts
```

The clients are currently untyped generics; wire the generated `Database` type
through them when the adapters are written.
