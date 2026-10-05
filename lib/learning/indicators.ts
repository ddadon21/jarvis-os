/**
 * Pine-compatible indicator math. Each function returns an array aligned with
 * its input where index i only uses values at or before i (no lookahead).
 * Seeding follows Pine v6: ta.ema / ta.rma start from the SMA of the first
 * `length` values; earlier slots are NaN.
 */

export type Series = number[];

export function sma(src: Series, length: number): Series {
  const out = new Array<number>(src.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < src.length; i += 1) {
    sum += src[i];
    if (i >= length) sum -= src[i - length];
    if (i >= length - 1) out[i] = sum / length;
  }
  return out;
}

function seededSmoothing(src: Series, length: number, alpha: number): Series {
  // Like Pine: smoothing starts at the first `length` valid (non-na) values,
  // seeded with their simple average; later na inputs carry the last value.
  const out = new Array<number>(src.length).fill(NaN);
  let start = -1;
  for (let i = 0; i < src.length; i += 1) {
    if (start < 0) {
      if (Number.isNaN(src[i])) continue;
      start = i;
    }
    if (i < start + length - 1) continue;
    if (i === start + length - 1) {
      let sum = 0;
      let valid = true;
      for (let k = start; k <= i; k += 1) {
        if (Number.isNaN(src[k])) { valid = false; break; }
        sum += src[k];
      }
      if (!valid) { start = -1; continue; }
      out[i] = sum / length;
      continue;
    }
    out[i] = Number.isNaN(src[i]) ? out[i - 1] : alpha * src[i] + (1 - alpha) * out[i - 1];
  }
  return out;
}

export const ema = (src: Series, length: number) => seededSmoothing(src, length, 2 / (length + 1));
export const rma = (src: Series, length: number) => seededSmoothing(src, length, 1 / length);

export function wma(src: Series, length: number): Series {
  const out = new Array<number>(src.length).fill(NaN);
  const denom = (length * (length + 1)) / 2;
  for (let i = length - 1; i < src.length; i += 1) {
    let acc = 0;
    let valid = true;
    for (let k = 0; k < length; k += 1) {
      const v = src[i - k];
      if (Number.isNaN(v)) { valid = false; break; }
      acc += v * (length - k);
    }
    if (valid) out[i] = acc / denom;
  }
  return out;
}

/** DEVIANT's HMA variant: wma(2*wma(n/2) - wma(n), int(sqrt(n) * speed)). */
export function deviantHma(src: Series, length: number, speed: number): Series {
  const half = wma(src, Math.trunc(length / 2));
  const full = wma(src, length);
  const raw = half.map((v, i) => 2 * v - full[i]);
  return wma(raw, Math.max(1, Math.trunc(Math.sqrt(length) * speed)));
}

export function trueRange(high: Series, low: Series, close: Series): Series {
  return high.map((h, i) => i === 0
    ? h - low[i]
    : Math.max(h - low[i], Math.abs(h - close[i - 1]), Math.abs(low[i] - close[i - 1])));
}

export const atr = (high: Series, low: Series, close: Series, length: number) => rma(trueRange(high, low, close), length);

/** ta.cci: (src - sma) / (0.015 * mean absolute deviation). */
export function cci(src: Series, length: number): Series {
  const mean = sma(src, length);
  const out = new Array<number>(src.length).fill(NaN);
  for (let i = length - 1; i < src.length; i += 1) {
    let dev = 0;
    for (let k = 0; k < length; k += 1) dev += Math.abs(src[i - k] - mean[i]);
    dev /= length;
    out[i] = dev === 0 ? 0 : (src[i] - mean[i]) / (0.015 * dev);
  }
  return out;
}

export function highest(src: Series, length: number): Series {
  return src.map((_, i) => {
    if (i < length - 1) return NaN;
    let m = -Infinity;
    for (let k = 0; k < length; k += 1) m = Math.max(m, src[i - k]);
    return m;
  });
}

export function lowest(src: Series, length: number): Series {
  return src.map((_, i) => {
    if (i < length - 1) return NaN;
    let m = Infinity;
    for (let k = 0; k < length; k += 1) m = Math.min(m, src[i - k]);
    return m;
  });
}

/**
 * Confirmed pivot highs/lows (ta.pivothigh semantics): a pivot at index p is
 * only known at index p + right. Returns, for every index, the most recent
 * pivot level confirmed at or before it.
 */
export function confirmedPivots(high: Series, low: Series, left: number, right: number) {
  const lastHigh = new Array<number>(high.length).fill(NaN);
  const lastLow = new Array<number>(low.length).fill(NaN);
  let ph = NaN;
  let pl = NaN;
  for (let i = 0; i < high.length; i += 1) {
    const p = i - right;
    if (p - left >= 0) {
      let isHigh = true;
      let isLow = true;
      for (let k = p - left; k <= p + right; k += 1) {
        if (k === p) continue;
        if (high[k] >= high[p]) isHigh = false;
        if (low[k] <= low[p]) isLow = false;
      }
      if (isHigh) ph = high[p];
      if (isLow) pl = low[p];
    }
    lastHigh[i] = ph;
    lastLow[i] = pl;
  }
  return { lastHigh, lastLow };
}
