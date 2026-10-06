# JARVIS OS

Personal executive operating system for Dwight / Himie Johnson Ventures: Trading, Finance, SentryOps and Life domains, an AI workforce, and a Windows Local Agent (Trading Observer) that turns live trading into durable data for the DEVIANT learning pipeline.

## Pages
| Path | What |
|---|---|
| `/work` | JARVIS Core: domains, chat (`/api/chat/stream`), voice |
| `/workforce` | Agents floor (top-down map, click a room to enter that agent's desk), approvals, work, outcomes |
| `/learning` | Learning Lab: bars, journaled entries, training runs, candidate vs DEVIANT v1 vs you, Pine download, shadow mode |
| `/login` | Owner login |

## Setup checklist
1. **Vercel environment variables** (see `.env.example`):
   - `JARVIS_OWNER_PASSCODE` — owner login (production refuses access without it)
   - `SUPABASE_SERVICE_ROLE_KEY` — durable storage (server only)
   - `CRON_SECRET` — authenticates scheduled jobs
   - `JARVIS_MARKET_WEBHOOK_SECRET` — 16+ characters, for the TradingView bar feed
   - `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` — chat and agents (model names: `lib/jarvis-models.ts`, overridable via `JARVIS_*_MODEL`)
2. **Database**: run every file in `supabase/migrations/` in the Supabase SQL editor, then open `/api/system/storage` — every table should report ok.
3. **Local Agent / Observer 1.0**: download the `JarvisObserver-win-x64` artifact from the "Build Jarvis Trading Observer" GitHub Action, run it, pair it from Trading, set the server address from the tray if you use a production domain, and choose your Obsidian vault folder.
4. **Market data**: add `trading/indicators/jarvis-bar-feed.pine` to a 1-minute NQ1!/MNQ1! chart with a webhook alert to `/api/trading/market-webhook`, and import CSV history in `/learning`.
5. Trade normally. The Observer journals every trade; the learning job runs weekdays after the close.

## Docs
- `docs/company/constitution.md` — controlling HJV Company Constitution\n- `docs/company/executive-operating-agreement.md` — GPT ↔ Claude executive partnership rules\n- `docs/company/sop-001-executive-session.md` — current bounded executive-session SOP\n- `docs/company/operating-structure.md` — orientation map; controlling details live in the Constitution/SOPs
- `docs/trading/learning-pipeline.md` — how learning works
- `docs/trading/ea-roadmap.md` — gates from candidate to any automation
- `docs/trading/deviant-learning-objective.md` — the objective
- `desktop/JarvisObserver/README.md` — Local Agent features and settings

## Development
```bash
npm ci
npm run dev
node --test tests/*.test.mjs                                   # web + learning tests
dotnet run --project desktop/JarvisObserver.CoreTests          # Observer journal/outbox/vault tests (any OS)
```
