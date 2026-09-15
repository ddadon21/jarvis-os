# DOMAIN: LIFE

## Mission

Maintain major goals, calendar context, important commitments, relocation
planning, major purchases and long-term planning — so that personal decisions
stay aligned with financial and business reality.

## What this domain is not

**Not a habit tracker.** No streaks, no routines, no daily check-ins, no
gamification. If a proposed feature would work equally well in a habit app, it
does not belong here.

The test for inclusion: does the entity carry **a date the user is committed
to**, or **a cost that shows up in Finance**? If neither, it is out of scope.

## What it does

Life is primarily a **conflict detector**. Its highest-value output is:

> This commitment costs $1,200 that the finance model has not been told about.
> Every readiness meter is currently optimistic by that amount.

Concretely:

- Track upcoming commitments and their financial impact.
- Track major decisions — relocation, vehicle, education, career, large
  purchases — each linked to a goal that carries the readiness criteria.
- Surface where a personal decision would move a financial goal backwards.

Note the division of labour: Life does not own readiness logic. "Can I move
out?" is a goal with six criteria in the Goal Engine; the Life record is the
*decision* that goal exists to serve.

## Rules

1. **Life reads readiness levels, not balances.** The Chief of Staff agent is
   prohibited from reading financial account detail.
2. **Every commitment with a cost reports that cost** so Finance can see it
   coming.
3. **No generic productivity features.**

## Planned schema

`commitments`, `major_decisions`. Calendar integration will add
`calendar_accounts` and an external-id mapping. Types in
`src/domains/life/types.ts`.

## Status in v0.1

Types, module contract and development data only. No calendar integration. The
module's one proposable move is reconciling committed costs with the finance
model — which is the domain's whole reason for existing, in miniature.
