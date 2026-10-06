# SOP-001 — Executive Session & Model Disagreement

**Version:** 1.0  
**Owner:** JARVIS  
**Authority:** HJV Constitution v1.0

## Trigger

Use an Executive Session when a task is material enough to benefit from GPT + Claude review, including:
- consequential strategy;
- architecture choices;
- significant product decisions;
- high-impact capital recommendations;
- repeated failures;
- proposed scope expansion.

Do not use two models for trivial routine work.

## v1 procedure — implemented now

1. JARVIS creates a unique session ID and fingerprints the caller-supplied objective/context without storing the raw context in the audit event.
2. JARVIS chooses a default Lead by a simple task classifier, or honors an explicit Lead preference.
3. Lead produces a proposal with evidence, risks, definition of done and rollback thinking.
4. Reviewer independently challenges the proposal and must end with a strict REVIEW protocol line.
5. Lead reconciles the objections and must end with a strict DECISION protocol line.
6. **JARVIS deterministically adjudicates the final result from both outputs. The Lead cannot approve over a rejecting/escalating Reviewer.**
7. Ambiguous, malformed or truncated protocol output becomes ESCALATE_DWIGHT / degraded rather than approval.
8. No action executes merely because models agree. v1 is recommendation-only and gives models no tools.
9. One durable `jarvis_runtime_events` audit entry is written for every session with policy versions, model calls, status, decision, token usage and context fingerprint.
10. Provider failure is explicit. A single-provider fallback is marked DEGRADED and `independentReview=false`.

## Planned v2 — not implemented yet

These are requirements for the next stage, not claims about current behavior:
- freeze a canonical evidence package from Jarvis world state rather than accepting only caller-supplied context;
- assign a formal authority class before model calls;
- route by measured provider/model health and historical task performance;
- send ESCALATE_DWIGHT results into the Founder approvals/notification path;
- add bounded session/cost quotas and tested Founder Away behavior.

## Stop conditions

Stop the session when:
- the dispute is resolved;
- a safe test is the next action;
- Founder authority is required;
- three model exchanges are complete;
- evidence is insufficient;
- provider failure prevents required review.

## Definition of done

The session is done when there is one explicit decision state, unresolved assumptions are recorded, next authority is known, the audit event is durable, and no unsupported claim of dual review is made.
