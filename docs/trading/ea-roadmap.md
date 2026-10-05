# From DEVIANT candidate to an EA — gates

JARVIS can grow into an automated strategy, but only by passing each gate with evidence. Live order placement remains a hard governance limit until Gate 5.

| Gate | What must be true | Where it shows |
|---|---|---|
| 1. Data | Observer 1.0 journaling every trade; bar feed alert running; history imported | Learning Lab cards 1–2 |
| 2. Candidate | A learned version catches more of your entries than DEVIANT v1 on unseen days at 1–2 arrows/day | Learning Lab report |
| 3. Shadow (≥ 3 months) | Daily replay/alerts vs your real trades keeps agreement stable; average R per arrow ≥ your own on the same stop/target model | `trading_signals`, daily learning runs |
| 4. Paper / sim | Arrows executed on a simulated account by a separate execution bridge (e.g. TradingView alert → broker sim), with position sizing, daily loss limit and kill switch | Separate repo/service, not inside JARVIS Core |
| 5. Live, small | Explicit owner decision, prop-firm rules confirmed in writing, smallest size, hard daily stop, manual kill switch | Owner approval recorded in `jarvis_approvals` |

Before Gate 4, check your prop firm's rules: many funded programs restrict or ban fully automated trading, copy trading, or certain execution bridges.

Signal contract (already used for shadow alerts, reusable by an execution bridge):
```json
{ "kind": "signal", "model": "v20261005-2215", "symbol": "NQ", "side": "LONG", "time": 1759670400000, "price": 21000.25 }
```
