# SOP-004 — Incident & Provider Failure

**Version:** 1.0  
**Owner:** Infra / Security / Integrations  
**Authority:** HJV Constitution v1.0

## Trigger
Runtime error, provider outage, stale data, failed durable write, broken deployment, lost device link, security warning, or repeated task failure.

## Procedure
1. Detect and timestamp the incident.
2. Preserve evidence before changing the system.
3. Classify severity and blast radius.
4. Stop unsafe or misleading behavior.
5. Keep durable state intact.
6. Fail over only to an approved alternative and mark the result degraded when independent review/quality is lost.
7. Apply the smallest reversible repair.
8. Verify recovery with machine evidence.
9. Record root cause and recurrence prevention.
10. Escalate to Dwight for critical security, money, external commitments, unavailable safe fallback, or prolonged material outage.

## Provider rule
A provider being configured does not mean it is healthy. Failure must be explicit; no subsystem may claim dual review or normal operation when one required provider failed.

## Definition of done
Service is verified healthy or intentionally degraded, state is preserved, cause is recorded, and no hidden unresolved critical risk remains.
