# JARVIS learning pipeline (no broker API)

Goal: learn where Dwight takes entries well enough to place DEVIANT arrows the way he would, then prove it on days the model never saw.

## Data in
| Source | What | How |
|---|---|---|
| Observer 1.0 trade journal | Every prepare, working order, cancel, entry, stop/target/size change and exit | Local state machine on the PC → `/api/trading/observer-events` (idempotent, retried offline) → `trading_trades`, `trading_trade_events` |
| Observer key frames | Chart frames around each trade | `/api/trading/observer-frames` → `jarvis-attachments/…/trade-frames/` |
| TradingView bar feed | Every closed 1-minute bar | `trading/indicators/jarvis-bar-feed.pine` + alert webhook → `/api/trading/market-webhook` → `trading_bars` |
| TradingView CSV | History for days already traded | Chart → Export chart data → Learning Lab import |

Micro and mini contracts share a price family (MNQ → NQ, MES → ES, …), so bars from NQ1! label MNQ trades.

## Labels
Each trade is labeled on the bar Dwight **decided** on: the last bar closed before he started preparing the order (when seen within 30 minutes of the fill), otherwise before the fill. Negatives are every other bar in sessions he traded, inside his own trading window. Bars within 3 bars of an entry are ignored as negatives (same setup, one bar early or late).

## Features (`lib/learning/features.ts`)
Each feature has a TypeScript and a Pine implementation and uses only closed data: candle body/range vs ATR, close position, EMA21 distance and slope, smoothed CCI, DEVIANT HMA slope and extremes, New York minute, 1H/4H trend, prior-day body, distance to the last confirmed 4H and daily pivots, 60-bar liquidity sweeps and reclaims, prior-day high/low sweeps, fair value gaps, DEVIANT bank-level rejections, relative volume and compression. Higher timeframes use the last **completed** bar and are aligned to the CME session (18:00 New York). A test proves no feature changes when future bars are added.

## Model
A shallow decision tree per side (weighted for 1–2 entries a day). Each positive leaf becomes a readable rule of at most three conditions. Rules are added greedily while they improve agreement with Dwight on the training sessions. Arrows follow the same policy as the generated indicator: rules OR-ed, inside the window, max 2 per day, 10-bar cooldown.

## Evaluation (`lib/learning/evaluate.ts`)
Chronological split: oldest 70% of sessions train, newest 30% test. On the unseen sessions the report shows, for the candidate, DEVIANT v1 and Dwight himself:
- entries caught (an arrow within 3 bars, same side)
- arrows that matched an entry
- arrows per day
- average outcome in R, using Dwight's median initial stop (in ATR) and median planned target (in R); if a bar hits both, the stop counts first.

## Output
`trading_model_versions` row with metrics, rules and a complete Pine v6 indicator (`DEVIANT - LEARNED v…`): arrows only, buy blue / sell black, optional `alert()` JSON for shadow scoring. Nothing is promoted automatically. The baseline file is never changed.

## Schedule
`/api/cron/learning` runs weekdays 22:15 UTC: replays the SHADOW model over the latest sessions into `trading_signals`, then retrains.

## Minimum data
First candidate: 40 entries and 3 unseen sessions with bars. Reliable: ~300 entries. At 1–2 trades a day that is roughly 2 months for a first look and 6–12 months for something trustworthy.
