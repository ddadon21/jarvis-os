# SECURITY

Jarvis holds financial positions, trading activity and business strategy for
one person. The threat model is not "a determined nation-state"; it is
**accidental exposure** — a leaked key, a missing RLS policy, a secret in a log
line, a mock number mistaken for a real balance.

## Row-level security

**Every table has RLS enabled and denies by default.** Enabling RLS with no
policy denies everything; each policy then grants back exactly one thing.

This is what makes the anon key safe to ship to the browser, and it is why the
application does not have to remember `where user_id = ...` on every query — a
forgotten filter returns nothing rather than someone else's balances.

Three tables are narrower than owner-only-everything:

| Table | Policies | Why |
| --- | --- | --- |
| `audit_log` | SELECT, INSERT | An audit trail that can be edited is not an audit trail. A trigger rejects UPDATE and DELETE as well. |
| `events` | SELECT, INSERT, constrained UPDATE | Append-only ledger. A trigger rejects changes to the event body; only `processing_status` and `processed_at` may move. |
| `goal_criterion_readings` | SELECT, INSERT | Editing a past measurement silently rewrites a goal's history. |

**Never add an UPDATE or DELETE policy to `audit_log`.** Its absence is the
control.

## Keys

| Key | Where it lives | Rule |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server | Safe **only** because of RLS. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Bypasses RLS entirely. |
| `ANTHROPIC_API_KEY` | Server only | Never reaches the client. |

The service-role client (`createSupabaseServiceClient`) is for background work
with no user session — scheduled ingestion, maintenance, migrations. **Never
use it to serve a user request.** If a request needs data the user-scoped
client cannot see, that is an RLS policy problem, not a reason to escalate.
Every call site must be reviewable on sight, which is why the helper throws
rather than falling back when the key is absent.

Nothing secret is ever prefixed `NEXT_PUBLIC_`. That prefix inlines the value
into the browser bundle.

## Configuration

All environment access goes through `src/lib/env.ts`, validated with Zod at
first use. Invalid config fails at boot rather than surfacing as `undefined`
three layers deep inside a money calculation.

`.env.example` contains names and comments only — never values. `.gitignore`
excludes `.env*` with an explicit `!.env.example`.

## Logging

Structured JSON via `src/lib/logger.ts`. **Never log:**

- credentials, API keys, access or refresh tokens
- full account numbers, card numbers, routing numbers
- raw transaction descriptions (they carry merchant and location detail)
- full document contents

Log ids and references, not payloads. Prefer a few high-signal lines over a
stream of trivia — Jarvis will eventually run continuously, and noisy logs
become unreadable exactly when they are needed.

## Trust boundaries

Everything crossing one is parsed with a Zod schema before it becomes a domain
object:

- HTTP request bodies and query parameters
- webhook payloads from brokers, banks and other providers
- file and CSV imports
- responses from third-party APIs — **including ones we trust**, because their
  contract can change without notice
- any model output that will drive an action

Internal function calls are typed, not re-validated.

## Autonomy as a security control

See `docs/PERMISSIONS.md`. The short version: capability ceilings live in code,
not in the database, so no row and no compromised write path can raise a
critical capability. `core.modify_permissions` is capped at RECOMMEND — Jarvis
can suggest a permission change but cannot stage one.

## Development data

Everything under `src/dev` is invented. Two rules:

1. Every surface rendering it says so — `dataQuality: "mock"` flows through
   World State into a badge on every panel.
2. No development number is ever presented as a real balance, position or
   market fact.

`getContainer()` throws when `JARVIS_DATA_SOURCE=supabase` but the adapters do
not exist, rather than falling back to mock data. A dashboard that lies
convincingly is worse than one that is plainly broken.

## Deployment

- The app sets `robots: { index: false, follow: false }`. It must never be
  indexed.
- Environment variables are set in Vercel project settings, never committed.
- Preview deployments must not point at production data.

## Not yet done

Authentication is not implemented — v0.1 runs with a fixed development user id
and no login. **Do not deploy this publicly until Supabase Auth is wired and
`requireUserId()` reads a real session.** There is also no rate limiting, no
CSRF protection on mutations (there are no mutations yet), no MFA requirement,
no session-timeout policy and no encryption of sensitive fields at rest beyond
what Supabase provides. Each is listed in `docs/ROADMAP.md` against the
milestone that needs it.
