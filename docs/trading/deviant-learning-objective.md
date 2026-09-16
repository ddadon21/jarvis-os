# DEVIANT Learning Objective

## Primary mission
Use Jarvis Trading Observer data from Dwight's actual live trading to improve DEVIANT's entry-arrow logic over time. The observer learns from Dwight's entries, management, exits, and chart context; DEVIANT does not need to be running while Dwight trades.

## Baseline
- Baseline Pine file: `trading/indicators/deviant-refined-baseline-v1.pine`
- Baseline is immutable. Future learned revisions get new versioned files.
- The Pine logic has broad freedom to change internally when evidence supports it.
- Visual contract is fixed: the finished indicator shows entry arrows only; buy arrows blue, sell arrows black. No HMA/EMA/bank-level lines, dashboards, labels, or other plotted clutter.
- Signal-density target: surface roughly 1-2 of the highest-quality trade opportunities per normal active trading day. Do not create extra arrows just to satisfy a quota when the learned setup is absent; quality takes priority over forced frequency.

## Evidence to collect from actual live trades
For every observed trade:
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
- pre-entry, entry, management, exit, and short post-exit chart frames
- higher-timeframe location and bias when observable
- nearby liquidity / sweep context when observable
- zone / POI context when observable
- gaps, iFVG/FVG, displacement, candle structure, and confirmation context when observable
- time from confirmation to entry when observable

## Research questions
1. What conditions are consistently present before Dwight takes his highest-quality live trades?
2. Which conditions are predictive rather than merely coincidental?
3. Which current DEVIANT rules fail to represent what Dwight actually does?
4. Can the learned conditions be expressed deterministically in Pine without lookahead/repainting?
5. Can DEVIANT rank or filter opportunities so approximately 1-2 high-quality arrows are shown on a normal active day?
6. Does each proposed revision improve unseen-trade expectancy, entry efficiency, drawdown, MAE/MFE, and signal quality rather than merely fitting prior trades?

## Change-control rules
- The observer learns from Dwight's live trading; it does not need DEVIANT signals as training labels.
- Do not optimize toward a guaranteed 100% win rate or assume recent results will persist unchanged.
- The code may be rewritten substantially when the evidence supports it.
- Never mutate the original baseline in place; every learned candidate is versioned so changes can be compared or rolled back.
- Prefer measurable hypotheses and out-of-sample / walk-forward checks before promoting a revision.
- Do not force a daily arrow solely to hit the 1-2/day target if no qualifying setup is present.
- Keep live execution manual until a separately validated shadow/paper execution system is reliable.

## Storage plan
- Raw TradingView visual evidence: local Jarvis Observer session folders first.
- Structured trade/context/event dataset: Jarvis persistence layer once wired.
- Human-readable trade summaries: Dwight's Notion `Funded Trading Journal`.
- Pine versions, experiments, metrics, and promotion history: versioned in the Jarvis repository.

## Near-term sequence
1. Prove the Windows observer reliably captures Dwight's normal TradingView Desktop layout.
2. Calibrate the chart area and visible Tradovate execution/position areas.
3. Extract the position lifecycle: FLAT -> ENTRY -> MANAGING -> EXIT.
4. Preserve pre-entry context and convert each observed live trade into a structured record.
5. Build the live-trade analysis loop and Notion journal writer.
6. Accumulate enough clean observed trades to identify repeatable entry features.
7. Generate versioned DEVIANT candidates from those features.
8. Test candidates on unseen data, with the design goal of about 1-2 highest-quality arrows per normal active trading day.
9. Promote only revisions that improve evidence-based performance while keeping the chart arrows-only.
