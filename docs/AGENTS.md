# AGENTS

## Principle

Jarvis itself is the **executive orchestrator**. It does not try to be the
expert in everything; it asks each specialist what is happening and synthesises
the answers into *the three things that actually matter today*.

**Do not create dozens of agents.** Twelve well-scoped specialists beat forty
overlapping ones. Every additional agent is another context boundary to reason
about, another permission surface to audit, and another way for two parts of
Jarvis to disagree about the same fact.

## Every agent declares five things

Before an agent is built, its surface is fixed:

1. **Domain** — exactly one.
2. **Responsibilities** — what it owns.
3. **Allowed capabilities** — nothing outside this list is reachable.
4. **Prohibited actions** — stated explicitly, even when implied.
5. **Memory scope** — which domains and classes it may read, and how much.
6. **Output contract** — the shape of what it returns.

That last one matters more than it looks. An agent without a declared output
contract is how you end up parsing prose to decide whether to move money.

## The registry

Declared in `src/core/agents/registry.ts`. **None of them run in v0.1** — the
value of writing them down now is that permissions and memory scope get decided
while they are still cheap to change.

| Agent | Domain | Max autonomy | Never |
| --- | --- | --- | --- |
| Trading Intelligence | trading | EXECUTE | Place any order; read finance data; edit a trade record |
| Trading Risk | trading | RECOMMEND | Place orders; change the user's risk limits |
| Strategy Scientist | trading | RECOMMEND | Place orders; present a hypothesis as a finding before the sample supports it |
| Finance CFO | finance | PREPARE | Move money; open or close accounts; read trading strategy detail |
| Accounting & Tax | finance | RECOMMEND | File anything; move money; present an estimate as professional advice |
| SentryOps Research | sentryops | EXECUTE | Contact anyone; record an observation as market fact |
| SentryOps Product | sentryops | RECOMMEND | External comms; deploy; advance a hypothesis without evidence |
| Software Engineering | sentryops | PREPARE | Deploy without approval; touch Jarvis's permission or audit code |
| Procurement & Sales | sentryops | PREPARE | Send anything unapproved; commit the user to price, scope or date |
| Life Chief of Staff | life | EXECUTE | Become a habit tracker; read financial account detail |
| Communications | core | EXECUTE | Read domain data beyond the payload it was handed |
| Security & Audit | core | RECOMMEND | Modify permissions; edit audit entries |

Note that the highest-autonomy agents are the ones doing bookkeeping —
journaling trades, classifying transactions, managing tasks. Everything that
touches money, external parties or production is capped at PREPARE or below,
regardless of how useful autonomy would be.

## Least context, least privilege

An agent's effective autonomy is the **lower** of its `maxActionLevel` and the
capability's `hardCeiling`. Both are declared in code. Neither can be raised by
a database row.

Agents do **not** all receive the user's whole data context. The Trading agent
does not need barber-client history; the SentryOps agent does not need every
Visa transaction. Jarvis Core reads the summaries when it needs to make a
cross-domain decision — that is what World State is for.

## Runtime state

`AgentState` (table `agent_states`) holds status, last run, last result, last
error, a resume `cursor` and per-agent config. The cursor lets a long-running
observer resume where it left off instead of reprocessing history — which
matters the first time a broker feed is replayed.

## Deferred

No agent runtime, no scheduling, no LLM orchestration, no tool-calling
framework, no inter-agent messaging. Those arrive with the first agent that has
real data to work on. Building an orchestration framework before then would be
designing against imagined requirements.
