# ROADMAP

Milestones are gated on evidence, not on time. Each one states what must be
true before the next begins.

---

## ✅ v0.1 — CORE FOUNDATION (this milestone)

Architecture, documentation, core schema, engines, shell.

**Done:** ten core engines; four isolated domain modules; core database schema
with RLS; ESLint-enforced boundaries; strict TypeScript; environment
validation; command-centre UI across seven screens; 49 unit tests covering
readiness, scoring, permissions, events and approvals.

**Deliberately absent:** authentication, Supabase adapters, every external
integration, every running agent, every LLM call, push/SMS/voice.

---

## v0.2 — REAL DATA

*Gate: nothing further is worth building on in-memory repositories.*

- Supabase project; run both migrations.
- Supabase Auth (email + magic link); `requireUserId()` reads a real session;
  middleware refreshes the session.
- Supabase repository adapters implementing every port.
- Generated database types wired through the clients.
- Manual entry for goals, criteria and criterion readings.
- Manual trade journal entry — the dataset starts accumulating **here**, and
  every week it does not is a week of evidence lost.
- Deploy to Vercel behind auth.

**Then:** rate limiting, CSRF on mutations, and the security items deferred in
`docs/SECURITY.md`.

---

## v0.3 — TRADING OBSERVER

*Gate: real trades are being journaled by hand, so the schema is known to fit.*

- `trading_accounts`, `trades`, `trade_executions`, `market_context`,
  `trade_setups`, `indicator_events`, `skipped_setups` migrations.
- The first platform adapter (Tradovate or TradeLocker) behind a provider
  interface — one adapter, not three.
- Automatic trade capture; reconciliation against manual entries.
- Screenshot capture into Supabase Storage.
- Skipped-setup and unsignalled-entry capture.

**Gate to v0.4: ~100 journaled trades with context.** Analysis before that
produces confident noise.

---

## v0.4 — TRADING ANALYTICS

- Expectancy by setup, session, day, context and HTF bias.
- Plan-adherence analysis; deviation cost quantified.
- Indicator signal quality; taken vs. skipped comparison.
- Strategy Scientist: falsifiable hypotheses with sample size and confidence
  intervals.
- `strategy_versions` with the evidence behind each change.

---

## v0.5 — FINANCE SYSTEM

- Finance schema migrations.
- Account modelling with purposes; manual balance entry.
- Transaction import (CSV first — it is unglamorous, it works, and it does not
  require handing credentials to an aggregator).
- Classification with an inferred/confirmed distinction.
- Allocation rules by stage; allocation proposals on `income.received`.
- Net-worth series; debt payoff modelling.
- Readiness meters driven by real account data.

---

## v0.6 — PROACTIVE CORE

*Gate: two domains carry real data, so there is something to be proactive about.*

- Background processor consuming pending events (Vercel Cron).
- Scheduled World State snapshots; change detection between them.
- Notification delivery — in-app, then web push.
- Approval UI end to end.
- The first agent that actually runs: Trading Intelligence, journaling only.

---

## v0.7 — SENTRYOPS RESEARCH

- SentryOps schema migrations.
- Agency and observation capture with evidence kinds enforced.
- Structured research workflow; source citation required.
- Hypothesis pipeline with stage gates.
- Competitor and contract tracking; renewal-date monitoring.

---

## v0.8 — ASK JARVIS

*Gate: there is real data to answer from. A chat box over invented numbers is
worse than no chat box.*

- Claude integration with per-domain context assembly.
- Memory retrieval feeding the context window under a budget.
- Structured tool calls bounded by the capability system.
- Every model-initiated action routed through approvals.

---

## v0.9 — SHADOW TRADER

*Gate: a measured, statistically meaningful edge exists.*

- Model trained on the user's own decisions.
- Shadow mode: the model predicts, takes nothing, and is scored against reality.
- Divergence analysis — where the model and the user disagree, and who was
  right.

**Paper trading only after shadow mode demonstrably outperforms.** Live
capital, if ever, arrives behind an explicit staged rollout with hard limits,
and `trading.live_order` stays capped at PREPARE until that day.

---

## Infrastructure: what earns its place, and when

| Addition | Trigger |
| --- | --- |
| Durable queue | A background worker exists and event volume outgrows cron |
| `pgvector` + embeddings | The memory corpus is large enough that scanning is the bottleneck |
| Extracted service | One domain's compute genuinely needs separate scaling |
| Caching layer | Measured slow reads, not anticipated ones |
| Component library | The hand-rolled primitives actually start costing time |

None of these are in v0.1, and none should be added on the strength of an
argument alone.
