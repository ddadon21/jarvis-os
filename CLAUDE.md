# CLAUDE.md — operating guide for Jarvis

This is the permanent brief for any Claude Code session working in this
repository. Read it before changing anything. When an architectural decision
here conflicts with something that seems locally convenient, the decision here
wins until it is deliberately changed and this file is updated with it.

---

## 1. What Jarvis is

Jarvis is a **persistent personal AI operating system** — the executive
intelligence layer above several separate operating domains.

It is not a chatbot, a productivity dashboard, a task manager, or a pile of
loosely related agents. Its loop is:

```
OBSERVE → STORE → SYNTHESIZE → PRIORITIZE → RECOMMEND
        → ACT (when authorized) → MEASURE → LEARN → REPEAT
```

The system is meant to become **proactive**: it maintains an accurate,
structured understanding of the user's current world and determines what
matters next, rather than waiting to be asked.

There is one Jarvis at the top and four operating systems underneath. They do
not blur together:

| Domain | Thinks like | Owns |
| --- | --- | --- |
| **Trading** | a trading researcher | trades, setups, market context, indicator events, strategy versions |
| **Finance** | a CFO | accounts, purposes, transactions, debt, allocation, net worth |
| **SentryOps** | a founder / product strategist | agencies, contracts, vendors, competitors, hypotheses, opportunities |
| **Life** | a chief of staff | commitments, major decisions, relocation, large purchases |

They share high-level goals through Jarvis Core. They share nothing else.

---

## 2. Architecture rules

**Read `docs/ARCHITECTURE.md` before structural work.** The short version:

1. **Domains are isolated.** `src/domains/trading` may never import
   `src/domains/finance`, and so on. This is enforced by ESLint
   (`no-restricted-imports` zones in `eslint.config.mjs`), not by good
   intentions. Cross-domain facts travel **upward** as events and World State
   slices, which Jarvis Core reads.
2. **Core is pure.** `src/core` contains the engines and has no I/O, no React,
   no Next.js and no knowledge of any specific domain. It declares **ports**
   (interfaces); `src/server` provides the **adapters**.
3. **Layers point one way:** `lib → core → domains → server → app/components`.
   Never the reverse.
4. **The composition root is `src/server/container.ts`.** It is the only file
   that knows which adapters are live. Nothing constructs its own dependencies.
5. **Business logic never lives in a React component.** Components receive
   finished data. If a component is computing a rollup, a score or a currency
   conversion, that logic belongs in `src/core` or a service.
6. **No god files.** A module that does two unrelated things becomes two
   modules.

---

## 3. Technical standards

- **TypeScript is strict**, including `noUncheckedIndexedAccess`. `any` is a
  lint error. If you genuinely need one, justify it in a comment on the line.
- **Validate at trust boundaries.** Anything from an HTTP request, a webhook,
  a file import or an external API is parsed with a Zod schema before it
  becomes a domain object. Internal function calls are typed, not validated.
- **Money is `bigint`/integer minor units (cents)** everywhere it is stored or
  computed. Floating-point dollars are a correctness bug in this codebase.
  Formatting to a display string happens only in `src/lib/format.ts`.
- **Environment access goes through `src/lib/env.ts`.** Nothing else reads
  `process.env`. Invalid config fails at boot, loudly.
- **Errors:** expected failures return `Result` (`src/lib/result.ts`);
  programmer errors throw.
- **Logging** is structured JSON via `src/lib/logger.ts`. Never log a
  credential, token, full account number or raw transaction description.
- **Tests** cover domain logic — readiness, scoring, permissions, event
  handling. UI polish does not need tests; a money calculation does.
- **Comments explain WHY.** A comment restating the code is noise; a comment
  explaining why the threshold is 0.5 is the reason the next person does not
  "simplify" it away.

Before calling work done: `npm run verify` (lint, typecheck, test, build).

---

## 4. Domain separation rules

- A domain module implements `DomainModule` (`src/core/domain-module.ts`) and
  answers exactly two questions: *what is happening?* and *what should I
  consider doing?*
- A domain publishes events **only for its own domain**. The Event Engine takes
  the domain from the catalog, not from the caller, so this cannot be faked.
- Agents get **least context**: the Trading agent does not see transactions;
  the SentryOps agent does not see balances. Memory scopes
  (`src/core/memory/types.ts`) are enforced inside the repository, so an
  out-of-scope record is unreachable rather than merely un-requested.
- **SentryOps has one extra rule that must never be relaxed:** a user field
  observation is never silently converted into a market-wide fact. Evidence
  carries an `evidenceKind` through every transformation, and promotion happens
  only through an explicit validation step with its own record.

---

## 5. Security rules

Read `docs/SECURITY.md`. Non-negotiables:

1. **Row-level security on every table**, deny by default, scoped to
   `auth.uid()`. The anon key is only safe because of this.
2. **The service-role key is server-only** and never used to serve a user
   request. If a request needs data the user-scoped client cannot see, that is
   an RLS policy problem — not a reason to escalate.
3. **No secrets in the repository.** `.env.example` holds names and comments
   only.
4. **`audit_log` is append-only.** There is no update or delete policy on it,
   for anyone, and a trigger enforces it. Do not add one.
5. **`events` are immutable** except for `processing_status` / `processed_at`.
6. **Capability ceilings live in code**, not in the database
   (`src/core/permissions/capabilities.ts`). A row cannot raise a critical
   capability past its `hardCeiling`.

---

## 6. What Claude must NOT casually change

These carry reasoning that is not obvious from the code. Changing any of them
is a deliberate decision that needs a note in the relevant doc:

- **The four-level autonomy ladder** (OBSERVE / RECOMMEND / PREPARE / EXECUTE)
  and every `hardCeiling` in `capabilities.ts`. Raising `trading.live_order`,
  `finance.move_money`, `finance.file_taxes`, `core.delete_records` or
  `core.modify_permissions` above their current ceiling is out of scope for any
  routine change.
- **The goal readiness rollup rules** in `src/core/goals/readiness.ts`,
  especially: a goal is GREEN only when *every* criterion is green, and a red
  blocking criterion vetoes the goal. Do not replace this with an average.
- **The Next Move scoring model** (`src/core/next-move/scoring.ts`). The
  weights are tunable; the *shape* — benefits × probability − penalties, with a
  dependency gate — is not, without saying why.
- **Domain isolation** and the ESLint zones that enforce it.
- **The append-only nature** of `events`, `audit_log` and
  `goal_criterion_readings`.
- **`src/dev/*` is mock data and must stay labelled as such.** Never present a
  development figure as a real balance, position or market fact, and never
  remove the `dataQuality` badge that says so.
- **Autonomous live trading is out of scope.** Do not build it, do not
  scaffold it, do not raise permissions toward it.

---

## 7. Keeping documentation true

When an architectural decision materially changes, update the doc that owns it
**in the same change**:

| Change | Update |
| --- | --- |
| Layers, boundaries, data flow | `docs/ARCHITECTURE.md` |
| A new event type | `docs/EVENTS.md` (and the catalog) |
| Memory classes or scoping | `docs/MEMORY.md` |
| An agent's surface or permissions | `docs/AGENTS.md` |
| Capabilities, ceilings, approvals | `docs/PERMISSIONS.md` |
| Any schema change | `docs/DATABASE.md` + a migration |
| RLS, secrets, key handling | `docs/SECURITY.md` |
| Domain scope or model | `docs/DOMAIN_*.md` |
| Milestone scope | `docs/ROADMAP.md` |

A doc that has drifted from the code is worse than no doc, because it is
trusted. If you find drift, fix it or delete the false claim.

---

## 8. Current state (v0.1 FOUNDATION)

**Built:** core engines (events, goals/readiness, next move, world state,
memory, permissions, approvals, audit, notifications, mission), four domain
modules, the core database schema with RLS, the dashboard shell and all seven
screens, 49 unit tests.

**Not built, deliberately:** authentication, Supabase repository adapters, any
external integration (broker, bank, calendar, public records), any running
agent, any LLM call, SMS/voice/push delivery.

**Everything on screen today is development data** from `src/dev`, served by
in-memory repositories. `JARVIS_DATA_SOURCE=supabase` throws rather than
falling back — a finance dashboard quietly showing invented numbers is the
worst thing this codebase could do.
