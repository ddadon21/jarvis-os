# EVENTS

## Why events

Everything meaningful becomes an event. This is the substrate that eventually
makes Jarvis proactive: once facts are events rather than rows quietly mutated
in place, Jarvis can notice **changes**, not just read current state. "Your
utilisation crossed 30% yesterday" is only possible if the crossing was
recorded as a thing that happened.

## The envelope

```ts
interface JarvisEvent {
  id: string;
  userId: string;
  eventType: EventType;      // from the catalog
  domain: Domain;            // taken from the catalog, never the caller
  source: string;            // manual | tradovate | plaid | jarvis.core | …
  importance: Importance;    // trivial | low | normal | high | critical
  payload: Record<string, unknown>;
  processingStatus: ProcessingStatus;
  correlationId?: string;
  causedByEventId?: string;
  occurredAt: string;        // when it happened
  recordedAt: string;        // when it was written
  processedAt?: string;
}
```

Three details that matter:

**`domain` comes from the catalog.** A domain cannot publish an event
attributed to another domain, because the caller never supplies the domain.

**`occurredAt` ≠ `recordedAt`.** Backfilled data has an `occurredAt` far older
than its `recordedAt`, and analysis must use the former. Getting this wrong
makes historical imports look like a burst of activity on import day.

**`correlationId` ties a causal chain together.** Income received → allocation
recommended → approval requested → money moved → goal progress updated is one
chain. Without it, reconstructing "why did Jarvis do that?" six months later is
guesswork.

## Lifecycle

```
pending → processing → processed
                    ↘ failed
        ↘ ignored
```

`ignored` is deliberate and meaningful: it records that Jarvis saw something
and chose not to act, which is itself data.

## Immutability

Events are **append-only**. Rows are never edited except to advance
`processingStatus` / `processedAt`, enforced by a database trigger
(`jarvis_events_immutable`). A fact that turns out to be wrong is corrected by
appending a new event, not by rewriting history.

## The catalog

Event types are declared in `src/core/events/catalog.ts` with their domain,
default importance and description. Free-form strings are not permitted: if a
type can be invented at a call site, nothing downstream can reliably subscribe
to it and the audit trail becomes untyped soup.

### Trading
`trade.executed` · `trade.closed` · `trade.journaled` · `signal.detected` ·
`signal.skipped` · `liquidity.swept` · `market.session_opened` ·
`strategy.hypothesis_formed`

### Finance
`transaction.posted` · `income.received` · `debt.payment_due` ·
`credit.utilization_changed` · `account.balance_changed` ·
`allocation.recommended`

### SentryOps
`contract.discovered` · `rfp.discovered` · `competitor.updated` ·
`agency.observed` · `hypothesis.validated` · `hypothesis.invalidated` ·
`lead.received`

### Life
`meeting.upcoming` · `commitment.made`

### Core
`goal.progress_updated` · `goal.readiness_changed` · `task.created` ·
`task.completed` · `agent.task_completed` · `approval.requested` ·
`approval.resolved` · `world_state.snapshot_taken` · `system.error`

## Importance

| Level | Meaning |
| --- | --- |
| `trivial` | Recorded for the dataset; never surfaced |
| `low` | Background context |
| `normal` | Ordinary domain activity |
| `high` | Worth the user's attention |
| `critical` | Money, deadlines or safety at stake |

The catalog sets a default per type; a caller may override it for a specific
occurrence. Triage sorts by importance first, then recency — a critical RFP
found this morning outranks a trivial balance change from a minute ago.

## Payload conventions

Payloads are type-specific and documented alongside the type. Two rules:

- **No secrets, tokens or full account numbers**, ever. Events are widely read.
- **Reference by id, don't embed.** A `trade.closed` payload carries
  `{ tradeId, rMultiple, realizedPnl }` — not a copy of the trade row, which
  would be stale the moment the row is corrected.

## Adding an event type

1. Add it to `src/core/events/catalog.ts` with domain and default importance.
2. Document its payload shape here.
3. Publish it from the domain that owns the fact.
4. Add a database consideration only if it needs a new index.

## Deferred

No in-process bus, no subscribers, no retries, no fan-out, no scheduled
processor. v0.1 is append, query and mark-processed. A durable queue earns its
place when there is a background worker to consume it — which arrives with the
first real integration, not before.
