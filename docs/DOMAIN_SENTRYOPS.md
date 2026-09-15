# DOMAIN: SENTRYOPS

## Mission

Continuously determine the strongest market opportunity for SentryOps, based on
evidence rather than attachment to the current product concept. Initial focus:
sheriff offices, public safety and government agency operations.

This domain is explicitly built to be able to say *"the evidence points
somewhere else — SentryOps should become something different."*

## Two kinds of evidence, permanently distinct

1. **Publicly verified** — public record, published contract, budget document,
   vendor site. Independently checkable.
2. **User field observation** — firsthand, from working or interning inside an
   agency environment. Strong evidence about *one* agency. No evidence at all
   about the market.

Also tracked: `inferred` (derived by Jarvis) and `unverified_report` (claimed
by a third party).

**The rule that must never be relaxed:** a user observation is never silently
converted into a market-wide fact. `evidenceKind` travels with every claim
through every transformation, and promotion happens only through an explicit
validation step that creates its own record.

What Jarvis *should* do is connect them:

> Publicly verified: this agency contracts with Vendor X.
> Field observation: staff were handling process Y by hand.
> → Vendor X covers A/B/C. Y appears to remain manual. **Research 20 comparable
> agencies to determine whether this is a repeatable market problem.**

That is the whole value of keeping them separate: the observation generates the
question, and the research answers it.

## The reasoning loop

```
OBSERVATION → RESEARCH → VALIDATION → MARKET FREQUENCY → PAIN
 → BUYER → EXISTING SOLUTIONS → COMPETITIVE GAP → PRODUCT OPPORTUNITY
 → PRODUCT SPEC → BUILD → DEMO → PILOT → CONTRACT → FEEDBACK → ITERATE
```

Modelled as `HypothesisStage` in `src/domains/sentryops/types.ts`. A hypothesis
advances only when the current stage's evidence bar is met — which is why
`evidenceSufficient: false` blocks a move rather than merely annotating it.

Compressed, the gate is:

```
Is it common? → Does it hurt? → Is money already being spent on it?
 → Who buys? → What competes? → Can we win?
```

## What must eventually be researched

Agencies, sheriff offices, departments, corrections, dispatch. Operational
structures and workflows. Existing systems and vendors. Competitors and their
customers. Government contracts, amounts, renewal dates. RFPs, procurement
routes and budgets. Public records. Decision makers. Pain points. Market and
technology gaps.

## Rules

1. **Every non-observation claim cites a source** with a URL, publisher and
   retrieval date.
2. **Every hypothesis states its falsification condition.** A hypothesis
   without one is a belief.
3. **Invalidation is recorded as loudly as validation.** `hypothesis.invalidated`
   is a high-importance event — killing a bad direction early is the most
   valuable thing this domain does.
4. **No outbound contact without an approved request.** `sentryops.send_outreach`
   is capped at PREPARE.
5. **Renewal dates and RFP deadlines are the only hard clocks** in this domain,
   and are the reason `rfp.discovered` is a critical-importance event.

## Planned schema

`agencies`, `agency_observations`, `vendors`, `competitors`, `contracts`,
`rfps`, `opportunities`, `research_sources`, `product_hypotheses`. Specified in
`docs/DATABASE.md`; types in `src/domains/sentryops/types.ts`.

## Status in v0.1

Types, module contract and development data only. No scraping, no public
records research, no competitor tracking, no outreach of any kind.
