import type { FeatureFrame } from "./features.ts";
import type { SignalPoint } from "./types.ts";

/**
 * DEVIANT - REFINED v1 (trading/indicators/deviant-refined-baseline-v1.pine)
 * replicated over a feature frame so learned candidates are always compared
 * against the immutable baseline on identical bars.
 */
export function deviantBaselineSignals(frame: FeatureFrame, options: { maxPerDay?: number; sessionStartHour?: number; sessionEndHour?: number } = {}): SignalPoint[] {
  const maxPerDay = options.maxPerDay ?? 3;
  const startHour = options.sessionStartHour ?? 8;
  const endHour = options.sessionEndHour ?? 15;
  const col = frame.columns;
  const out: SignalPoint[] = [];
  let longCount = 0;
  let shortCount = 0;
  let longFired = false;
  let shortFired = false;
  let longBar = 0;
  let shortBar = 0;

  for (let i = 0; i < frame.t.length; i += 1) {
    if (i > 0 && frame.session[i] !== frame.session[i - 1]) {
      longCount = 0;
      shortCount = 0;
    }
    const hour = Math.floor(frame.nyMinute[i] / 60);
    const inSession = hour >= startHour && hour < endHour;
    const body = Math.abs(frame.close[i] - frame.open[i]);
    const bull = frame.close[i] > frame.open[i] && body > 10;
    const bear = frame.close[i] < frame.open[i] && body > 10;
    const cciBull = col.cci_smooth[i] > 30;
    const cciBear = col.cci_smooth[i] < -30;
    const volOk = col.range_atr[i] > 0.8;

    const longSetup = col.bank_long_rej[i] === 1 && col.hma_at_low[i] === 1 && bull && (cciBull || volOk) && inSession && longCount < maxPerDay;
    const shortSetup = col.bank_short_rej[i] === 1 && col.hma_at_high[i] === 1 && bear && (cciBear || volOk) && inSession && shortCount < maxPerDay;

    const longSignal = longSetup && !longFired;
    const shortSignal = shortSetup && !shortFired;
    if (longSignal) { longCount += 1; longFired = true; longBar = i; out.push({ index: i, t: frame.t[i], side: "LONG", price: frame.close[i] }); }
    if (shortSignal) { shortCount += 1; shortFired = true; shortBar = i; out.push({ index: i, t: frame.t[i], side: "SHORT", price: frame.close[i] }); }
    if (i - longBar > 10) longFired = false;
    if (i - shortBar > 10) shortFired = false;
    if (!inSession) { longFired = false; shortFired = false; }
  }
  return out;
}
