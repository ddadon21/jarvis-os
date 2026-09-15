# JARVIS

A persistent personal AI operating system — the executive layer above four
separate operating domains: **Trading**, **Finance**, **SentryOps** and
**Life**.

> **v0.1 FOUNDATION.** Architecture, core engines, database schema and the
> command-centre shell. Everything on screen is clearly-labelled development
> data. There is no authentication, no external integration and no running
> agent yet. Do not deploy publicly until auth is wired — see
> [`docs/SECURITY.md`](docs/SECURITY.md).

## Stack

Next.js 16 (App Router) · TypeScript (strict) · Tailwind CSS v4 · Supabase
(Postgres, Auth, Storage) · Vercel · Vitest

## Local setup

```bash
git clone https://github.com/ddadon21/jarvis-os.git
cd jarvis-os
npm install

cp .env.example .env.local     # defaults run against in-memory dev data
npm run dev                    # http://localhost:3000
```

No Supabase project is required to run the app. `JARVIS_DATA_SOURCE=dev` (the
default) serves everything from in-memory repositories seeded with development
data.

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint, including domain-boundary rules |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest |
| `npm run verify` | All four, in order — run before committing |

## Environment

Full annotated list in [`.env.example`](.env.example). Nothing reads
`process.env` directly; everything goes through `src/lib/env.ts`, which
validates at boot and refuses to start on bad config.

| Variable | Required | Notes |
| --- | --- | --- |
| `JARVIS_DATA_SOURCE` | no | `dev` (default) or `supabase` |
| `NEXT_PUBLIC_APP_URL` | no | Defaults to `http://localhost:3000` |
| `NEXT_PUBLIC_SUPABASE_URL` | when `supabase` | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | when `supabase` | Safe in the browser **only** because RLS is on every table |
| `SUPABASE_SERVICE_ROLE_KEY` | no | Server only. Bypasses RLS. |
| `ANTHROPIC_API_KEY` | no | Reserved; unused in v0.1 |

## Database

Migrations live in `supabase/migrations/`. With the Supabase CLI linked to a
project:

```bash
npx supabase db push
```

Two migrations: the core schema, and row-level security. Domain tables for
Trading, Finance and SentryOps are **specified** in
[`docs/DATABASE.md`](docs/DATABASE.md) but deliberately not created yet.

## Layout

```
src/
  app/          Routes. Server Components by default.
  components/   UI primitives and dashboard panels. No business logic.
  core/         Jarvis Core engines. Pure — no I/O, no React, no Next.
  domains/      trading · finance · sentryops · life. Isolated siblings.
  server/       Adapters, services, composition root.
  lib/          env · logger · result · ids · time · format
  dev/          Development data. Clearly labelled, never presented as real.
supabase/migrations/
docs/
```

Layer boundaries are enforced by ESLint, not convention: a cross-domain import
is a lint error. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Documentation

| Doc | |
| --- | --- |
| [CLAUDE.md](CLAUDE.md) | Operating guide for future Claude Code sessions |
| [docs/VISION.md](docs/VISION.md) | What Jarvis is and where it is going |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layers, ports, data flow |
| [docs/DOMAIN_TRADING.md](docs/DOMAIN_TRADING.md) | Trading domain |
| [docs/DOMAIN_FINANCE.md](docs/DOMAIN_FINANCE.md) | Finance domain |
| [docs/DOMAIN_SENTRYOPS.md](docs/DOMAIN_SENTRYOPS.md) | SentryOps domain |
| [docs/DOMAIN_LIFE.md](docs/DOMAIN_LIFE.md) | Life domain |
| [docs/EVENTS.md](docs/EVENTS.md) | Event model and catalog |
| [docs/MEMORY.md](docs/MEMORY.md) | Layered memory architecture |
| [docs/AGENTS.md](docs/AGENTS.md) | Specialist agent registry |
| [docs/PERMISSIONS.md](docs/PERMISSIONS.md) | Autonomy ladder and approvals |
| [docs/DATABASE.md](docs/DATABASE.md) | Schema, current and planned |
| [docs/SECURITY.md](docs/SECURITY.md) | RLS, keys, trust boundaries |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Milestones and their gates |

## Deploying to Vercel

Import the repository, set the environment variables above in project settings,
and deploy — no build configuration is needed. The app is a PWA and installs to
the iPhone home screen via Safari's *Add to Home Screen*.

**Not before authentication exists.**
