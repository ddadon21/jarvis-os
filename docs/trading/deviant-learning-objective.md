# DEVIANT Learning Objective

## Primary mission
Use Jarvis Trading Observer data to improve Dwight's DEVIANT entry-arrow logic over time without changing the current indicator prematurely.

## Baseline
- Baseline Pine file: `trading/indicators/deviant-refined-baseline-v1.pine`
- Baseline is immutable. Future revisions get new versioned files.
- Current visual contract from Dwight: the finished indicator should remain minimal and show entry arrows only; buy arrows blue, sell arrows black.

## Evidence to collect
For every observed actual trade:
- symbol / contract
- direction
- quantity
- entry / exit
- initial and modified stop
- target / limit changes
- realized and floating P&L
- time/session
- MFE / MAE where observable
- partial exits / scale-ins
- pre-entry and post-entry chart frames
- whether a DEVIANT arrow was present near the decision

For every DEVIANT signal once signal capture is enabled:
- signal timestamp and price
- long/short
- all current indicator feature values
- whether Dwight took the trade
- subsequent excursion and outcome labels (for example: +1R before -1R, MFE, MAE, time-to-target)

## Research questions
1. Which DEVIANT signals correspond to the trades Dwight actually selects?
2. Which market-context features separate good signals from bad signals?
3. Can those features be expressed deterministically in Pine without lookahead/repainting?
4. Does each proposed filter improve out-of-sample expectancy, drawdown, and signal quality rather than merely reducing signal count?

## Change-control rules
- Do not optimize toward a claimed 100% win rate or guarantee future performance.
- Do not change production signal logic from a tiny sample.
- Every revision must preserve the prior baseline and identify exactly what changed.
- Prefer one hypothesis per revision so cause/effect stays measurable.
- Validate on unseen dates / walk-forward samples before promoting a revision.
- Keep live execution manual until a separately validated shadow/paper system is reliable.

## Storage plan
- Raw TradingView evidence: local Jarvis Observer session folders first.
- Structured signal/trade/event dataset: Jarvis persistence layer (database) once wired.
- Human-readable trade summaries: Dwight's Notion `Funded Trading Journal`.

## Near-term sequence
1. Prove the Windows observer reliably captures TradingView Desktop.
2. Calibrate the Tradovate panel and chart region.
3. Extract position lifecycle into structured events.
4. Add DEVIANT signal capture so skipped arrows are recorded too.
5. Establish baseline statistics before changing the Pine logic.
6. Test learned revisions in shadow mode before Dwight relies on them daily.
