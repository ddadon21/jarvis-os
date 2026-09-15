# VISION

## What Jarvis is

Jarvis is a persistent personal AI operating system: the executive intelligence
layer above several separate operating domains. Its purpose is to maintain an
accurate, structured understanding of the user's world and continuously answer
one question — **what matters next?**

It is explicitly not a chatbot, a productivity dashboard, a task manager, or a
collection of unrelated agents. Those are surfaces; this is a system.

## The loop

```
OBSERVE → STORE → SYNTHESIZE → PRIORITIZE → RECOMMEND
        → ACT (when authorized) → MEASURE OUTCOMES → LEARN → REPEAT
```

The last three steps are what separate Jarvis from a reporting tool. A
recommendation that is never measured cannot improve, and a system that never
improves is a dashboard with extra steps.

## Why the domains stay separate

One Jarvis at the top; four operating systems underneath, each with its own
data, memory, rules and tools.

- **Trading Jarvis** thinks like a trading researcher.
- **Finance Jarvis** thinks like a CFO.
- **SentryOps Jarvis** thinks like a founder and product strategist.
- **Life Jarvis** thinks like a chief of staff.

They share high-level goals. They do not share context. The trading agent has
no business reading transaction history, and the SentryOps agent has no
business reading balances — not because it would be embarrassing, but because
unfocused context produces unfocused reasoning, and because least-privilege is
the only durable answer to "what could this agent leak?".

Jarvis Core asks each domain the same two questions — *what is happening?* and
*what should I consider doing?* — and synthesises the answers. That is the
entire integration surface between domains.

## The destination, per domain

**Trading.** Watch how the user actually trades. Journal every executed trade
and every skipped setup with the context around both. Accumulate a dataset over
months and years until the real edge is measurable rather than asserted. Then:
observer → journal → analytics → strategy scientist → shadow trader → paper
trader → carefully controlled live system. The destination is a model that
trades like the user and then better — arrived at by evidence, not by guessing,
and not by shortcut.

**Finance.** Understand the complete financial system, including the *purpose*
of every account. Direct each incoming dollar deliberately. Move the user
through stages — debt → stability → reserves → credit → capital → investing →
asset ownership → $100K → $1M → beyond — and answer questions like "can I move
out?" or "should I buy this car?" in terms of the goals the decision moves, not
in terms of whether the payment technically clears.

**SentryOps.** Determine what SentryOps should become, based on evidence rather
than attachment to the current concept. Keep publicly verified facts and the
user's firsthand field observations as separate kinds of evidence, permanently.
Run every idea through the loop: observation → research → is it common? → does
it hurt? → is money already being spent on it? → who buys? → what competes? →
can we win? Be willing to recommend a different direction entirely.

**Life.** Keep personal decisions aligned with financial and business reality.
Not a habit tracker; a conflict detector.

## Readiness, not percentages

Every major objective is a set of criteria, each measured independently and
rolled up to RED / YELLOW / GREEN.

```
MOVE OUT — RED
  income consistency   ███████░░░  3.5 / 6 months   [REQ]
  emergency reserve    ██░░░░░░░░  $2,000 / $9,000
  debt position        ████░░░░░░  $9,400 → $3,000
  credit utilisation   ███████░░░  34% → 10%
  move-in capital      ████░░░░░░  $1,800 / $4,500
  cash flow after rent █████░░░░░  $420 / $800
```

"47%" is a number. The list above is a set of instructions. Jarvis must always
be able to say exactly what changes RED → YELLOW → GREEN.

## The long game

The value of this system compounds with the data it accumulates. A trade
journaled today is worth more in two years than it is this week; a validated
market observation is worth more after twenty comparable agencies have been
checked. Which is why the early milestones are about getting the model,
the boundaries and the evidence discipline right — the interesting behaviour is
only possible on top of a dataset that was recorded carefully from the start.
