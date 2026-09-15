# MEMORY

## The core decision

**Do not dump everything into one vector database.**

A trade's entry price is not "semantically similar" to anything. It is exactly
$4,512.25, and it belongs in a column where it can be summed, filtered and
joined. Embedding it destroys every property that makes it useful and buys
nothing.

The rule for this codebase: **a fact that fits a relational table stays in a
relational table.** The memory system stores what genuinely does not — context,
narrative, lessons and documents.

## The layers

| Class | Holds | Stored where |
| --- | --- | --- |
| **Working** | Current task/conversation state | `memories` (ephemeral, bounded) |
| **Domain** | Long-lived context owned by one domain | `memories` |
| **Episodic** | Significant outcomes and lessons drawn from them | `memories` |
| **Document** | Research, contracts, reports, uploads | `memories` (chunks) + Supabase Storage (originals) |
| **Structured** | Trades, transactions, goals, agencies, contracts | **Domain tables. Never `memories`.** |
| **Semantic** | Embedding-backed recall over the above | An index, not a source of truth |

`structured` exists as a named class so code can talk about *where a fact
lives* without pretending it lives in the memory table.

## Beliefs have a validity interval

```ts
validFrom: string;
validUntil?: string;
supersededById?: string;
```

A memory is never overwritten. It is superseded, and both versions survive:

> "We thought agencies bought on price; we now believe they buy on integration
> effort, as of 14 March."

That transition is more valuable than either belief alone — it is the record of
Jarvis learning something. Overwriting would erase it.

## Evidence and confidence

Every memory carries `evidenceKind` (`public_verified` / `user_observation` /
`inferred` / `unverified_report`) and a 0..1 `confidence`. This matters most in
SentryOps, where conflating a field observation with a market fact produces
confident nonsense — but it applies anywhere Jarvis reasons from mixed-quality
evidence.

## Scoping: least context

```ts
interface MemoryScope {
  domains: Domain[];
  classes: StorableMemoryClass[];
  maxRecords: number;
}
```

Every agent declares a scope (`src/core/agents/registry.ts`). The Trading
agent sees trading memory; the SentryOps agent sees SentryOps memory; neither
sees the other's.

**Scope is enforced inside the repository**, not by the caller. An
out-of-scope record is *unreachable*, not merely un-requested. This is a
security control as much as a cost control: the cheapest way to guarantee an
agent cannot leak transaction history is for its query to be incapable of
returning it.

`maxRecords` keeps prompts bounded, which is why `summary` exists alongside
`content` — the short form is what gets packed when a budget is tight.

## Retrieval today

The in-memory adapter does substring matching over title and content, filtered
by scope, validity and importance. That is honest for v0.1 and deliberately not
called "semantic search". Real recall — `pgvector`, embeddings, hybrid ranking
— lands when there is a corpus large enough that scanning it is actually the
bottleneck.

## Deferred

Embeddings and `pgvector`. Automatic summarisation and consolidation. Decay and
forgetting policies. Cross-domain memory synthesis at the Core level.
