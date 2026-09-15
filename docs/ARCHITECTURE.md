# ARCHITECTURE

## Shape

A **modular monolith** on Next.js App Router, deployed to Vercel, backed by
Supabase Postgres.

Not microservices. Not a separate API server. One user, one deployment, four
domains that must not blur — the hard problem here is *boundaries*, and
boundaries are enforceable inside a single codebase with far less operational
cost. Services can be extracted later if scale ever demands it; the ports and
adapters below are what make that extraction mechanical rather than a rewrite.

## Layers

```
┌──────────────────────────────────────────────────────────┐
│  src/app, src/components        UI. No business logic.   │
├──────────────────────────────────────────────────────────┤
│  src/server                     Adapters, services,      │
│                                 composition root.        │
├──────────────────────────────────────────────────────────┤
│  src/domains/{trading,finance,sentryops,life}            │
│                                 Isolated siblings.       │
├──────────────────────────────────────────────────────────┤
│  src/core                       Engines. Pure, no I/O.   │
├──────────────────────────────────────────────────────────┤
│  src/lib                        Primitives.              │
└──────────────────────────────────────────────────────────┘
```

Dependencies point **downward only**. Enforced by `no-restricted-imports` zones
in `eslint.config.mjs`:

| Layer | May not import |
| --- | --- |
| `src/lib` | anything above it |
| `src/core` | domains, server, app, components, React, Next |
| `src/domains/X` | any other domain, app, components |
| `src/components` | `src/server` |

Test files are exempt, since wiring a real adapter is how the engines get
exercised end to end.

## Ports and adapters

`src/core` declares interfaces; `src/server/repositories` implements them.

```
core/events/ports.ts        EventRepository
core/goals/ports.ts         GoalRepository
core/memory/ports.ts        MemoryRepository
core/approvals/ports.ts     ApprovalRepository
core/audit/ports.ts         AuditRepository
core/notifications/ports.ts NotificationRepository
core/world-state/ports.ts   WorldStateRepository
```

Two adapter sets are planned; one exists:

- **In-memory** (`src/server/repositories/in-memory.ts`) — active when
  `JARVIS_DATA_SOURCE=dev`. Lets the whole system be built and tested without a
  database. State lives in the process, so nothing survives a restart and
  nothing is shared between serverless invocations. Development only.
- **Supabase** — not yet written. `getContainer()` **throws** when
  `JARVIS_DATA_SOURCE=supabase`, rather than silently falling back to mock
  data. A finance dashboard confidently displaying invented numbers is the
  worst failure this system can have.

Domains declare their own narrow read ports too (`src/domains/*/ports.ts`), so
a broker or bank adapter has a small, obvious interface to satisfy.

## The domain contract

Every domain implements `DomainModule` (`src/core/domain-module.ts`):

```ts
interface DomainModule {
  domain: Domain;
  mission: string;
  getStateSlice(context: DomainContext): Promise<WorldStateSlice>;
  proposeMoves(context: DomainContext): Promise<MoveCandidate[]>;
}
```

That is the entire surface between a domain and Jarvis Core. Core never reaches
into a domain's tables and never reinterprets its numbers. A domain can be
rewritten wholesale without core noticing.

`DomainContext` carries `now` explicitly rather than reading the clock, so
snapshots, backtests and tests are reproducible.

## Jarvis Core

| Engine | Location | Responsibility |
| --- | --- | --- |
| Mission | `core/mission` | Standing directives; the top-level rollup |
| Goal | `core/goals` | Multi-criteria readiness (RED/YELLOW/GREEN) |
| World State | `core/world-state` | Structured "what is happening" + snapshots |
| Event | `core/events` | Append-only ledger; the basis for proactivity |
| Next Move | `core/next-move` | Multi-factor ranking across all domains |
| Memory | `core/memory` | Layered memory with per-agent scoping |
| Agents | `core/agents` | Specialist registry and runtime state |
| Permissions | `core/permissions` | Capability ceilings and autonomy levels |
| Approvals | `core/approvals` | PREPARE → EXECUTE consent flow |
| Audit | `core/audit` | Append-only record of who did what and why |
| Notifications | `core/notifications` | Urgency ladder and channel routing |

Two design notes worth keeping:

**Failure is partial, not total.** `WorldStateService.capture()` uses
`Promise.allSettled`. A domain that throws produces an `unavailable` slice with
the reason, and the other three still render. Silently omitting the slice would
be worse than either — a missing panel reads as "nothing is happening".

**Readiness is computed on read, not stored.** Criterion values move for
reasons no single write path controls. A cached verdict would be stale more
often than right. When this becomes expensive, cache the computation, not the
conclusion.

## Data flow

```
integration / user input
        │
        ▼
   domain module ──── publishes ───▶ events (append-only)
        │                                  │
        │ getStateSlice                    │
        ▼                                  ▼
   World State ────────▶ Mission Engine ◀── goals + criteria
        │                     │
        │ proposeMoves        │
        ▼                     ▼
   Next Move Engine ────▶ ranked moves ────▶ UI
                               │
                               ▼
                        approval request ──▶ user consent ──▶ execution
                               │                                  │
                               └──────────── audit log ◀──────────┘
```

## Rendering

Server Components by default. `src/server/services/overview.ts` composes every
engine once per request (wrapped in React's `cache`, so the shell and the page
share one pass) and hands finished data to components. Client Components are
used only where interactivity demands it — currently just the navigation, for
active-route highlighting.

## Conventions

- Money: integer minor units (cents) everywhere; formatted only at the edge.
- Timestamps: UTC ISO-8601 strings in TypeScript, `timestamptz` in Postgres.
- Ids: UUID v4, database-generated by default.
- Validation: Zod at trust boundaries only. Internal calls are typed, not
  re-validated.
- Errors: `Result` for expected failures; throw for programmer errors.

## Deliberately not here

No message queue, no background worker, no vector database, no separate API
service, no ORM, no state management library, no component library. Each of
these is a real answer to a real problem — none of which this system has yet.
Adding them now would buy complexity today against a benefit that may never
arrive. See `docs/ROADMAP.md` for the conditions under which each earns its
place.
