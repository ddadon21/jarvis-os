# PERMISSIONS & AUTONOMY

## The ladder

Four levels, strictly ordered. Each implies the ones below it.

| Level | Jarvis may |
| --- | --- |
| **OBSERVE** | Read and watch. Nothing else. |
| **RECOMMEND** | Analyse and suggest. |
| **PREPARE** | Construct a fully-specified action and wait for approval. |
| **EXECUTE** | Perform the action, when explicitly authorised for it. |

Autonomy is granted **per capability**, never globally. There is no "trust
Jarvis" switch, and there never will be.

## Hard ceilings live in code

Every capability declares a `hardCeiling` in
`src/core/permissions/capabilities.ts`: the highest level it can **ever** be
granted, regardless of what any database row says.

Evaluation order (`src/core/permissions/policy.ts`):

1. Start from the capability's default level.
2. Apply the user's grant, if one exists and has not expired.
3. **Clamp to the hard ceiling — always.**
4. Compare against the level being requested.

Step 3 runs last so that no amount of configuration, no corrupted row and no
compromised write path can raise a critical capability past its code-declared
limit. Configuration is easy to change by accident; code requires a commit, a
review and a deploy. That asymmetry is the entire design.

## Capabilities capped below EXECUTE

| Capability | Risk | Ceiling |
| --- | --- | --- |
| `trading.live_order` | critical | PREPARE |
| `finance.move_money` | critical | PREPARE |
| `finance.file_taxes` | critical | PREPARE |
| `sentryops.deploy_production` | critical | PREPARE |
| `core.delete_records` | critical | PREPARE |
| `sentryops.send_outreach` | high | PREPARE |
| `core.modify_permissions` | critical | **RECOMMEND** |

`core.modify_permissions` is the one capability capped below PREPARE. Even a
prepared permission change is a mistake waiting to happen: a proposal plus a
distracted approval is exactly how a system quietly grants itself execution.
Jarvis may suggest a permission change. It may not stage one.

A unit test asserts that no `critical` capability has an EXECUTE ceiling, so
this cannot be undone by accident.

## Approval requests

The bridge from PREPARE to EXECUTE (`src/core/approvals/`).

```
agent prepares a concrete action
  → approval_requests row (pending, with an expiry)
  → audit entry + approval.requested event
  → user approves or denies
  → audit entry + approval.resolved event
  → the capability handler executes and reports back
  → markExecuted / markFailed
```

Four properties worth defending:

**Consent and execution are separate steps.** `approve()` records consent and
returns; it does not execute. A bug in an executor can therefore never be
mistaken for a bug in the approval path, and every attempt is separately
auditable.

**Requests expire.** Conditions move. A six-hour-old proposal to move money may
no longer be the right action, so an expired request transitions to `expired`
rather than being quietly approved.

**The payload is re-validated at execution time.** An approval is consent, not
proof that the action is still valid.

**Every high- and critical-risk execution requires an approval**, even when the
capability is granted — `requiresExplicitApproval()` is independent of the
grant level.

## Audit

Every permission check is logged, **on both branches**. A log containing only
successful actions cannot tell you that something tried to move money forty
times.

`audit_log` is append-only: no update policy, no delete policy, plus a trigger
that rejects both. That absence is the control. Do not add them.

## Deferred

Time-boxed grants exist in the model (`expiresAt`) but there is no UI to create
them. There is no per-agent override layer beyond `maxActionLevel`, no
step-up re-authentication, and no notification channel for approvals beyond the
in-app feed.
