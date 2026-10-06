# SOP-003 — Build → Test → QA → Release

**Version:** 1.0  
**Owner:** Builder + QA  
**Authority:** HJV Constitution v1.0

## Purpose
Ship small, reversible, verified changes without letting the creator approve its own material work.

## Procedure
1. Reproduce or define the problem before editing.
2. Prefer the smallest reversible intervention.
3. Builder works on an isolated branch for material changes.
4. Add or update tests that represent the actual failure/acceptance criteria.
5. Run relevant unit/type/build tests.
6. QA independently reviews evidence and adversarial cases.
7. For material architecture/governance changes, use peer executive review when available.
8. Fix review blockers before merge.
9. CI and deployment preview must pass.
10. Merge only after the required independent approval exists.
11. Verify production behavior after merge.
12. If the change worsens the measured outcome, revert or disable it.

## Definition of done
The problem is resolved in production, the test evidence exists, rollback is known, and the audit trail identifies creator and reviewer.
