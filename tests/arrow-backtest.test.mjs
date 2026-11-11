import test from 'node:test';
import assert from 'node:assert/strict';
import { backtestArrows, deviantArrows, resampleBars, scoreArrow, summarize, DEVIANT_V1, DEFAULT_SCORING } from '../lib/learning/arrow-backtest.ts';
import { computeFeatures, nyLocal } from '../lib/learning/features.ts';
import { deviantBaselineSignals } from '../lib/learning/baseline.ts';

const MIN = 60_000;
// 2026-03-02 (Mon) 18:00 New York = 23:00 UTC (EST). CME session for 2026-03-03.
const SESSION_OPEN = Date.UTC(2026, 2, 2, 23, 0);

function randomWalk(n, start, seed = 7, stepSize = 18) {
  let s = seed;
  const rand = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const bars = [];
  let price = start;
  for (let i = 0; i < n; i += 1) {
    const o = price;
    const c = o + (rand() - 0.5) * stepSize * 2;
    const h = Math.max(o, c) + rand() * stepSize;
    const l = Math.min(o, c) - rand() * stepSize;
    bars.push({ t: SESSION_OPEN + i * MIN, o, h, l, c, v: 1 });
    price = c;
  }
  return bars;
}

test('arrows match the existing DEVIANT baseline replica bar for bar', () => {
  const bars = randomWalk(6 * 1440, 21000, 11, 22);
  const mine = deviantArrows(bars, 1, DEVIANT_V1).map((a) => `${a.index}:${a.side}`);
  const baseline = deviantBaselineSignals(computeFeatures(bars)).map((s) => `${s.index}:${s.side}`);
  assert.ok(baseline.length > 5, `expected some baseline arrows, got ${baseline.length}`);
  assert.deepEqual(mine, baseline);
});

test('4h bars align to the 18:00 New York session open and cut at the 17:00 close', () => {
  const bars = randomWalk(23 * 60, 21000);
  const h4 = resampleBars(bars, 240);
  const opens = h4.map((b) => nyLocal(b.t).minute / 60);
  assert.deepEqual(opens, [18, 22, 2, 6, 10, 14]);
  assert.equal(h4.at(-1).c, bars.at(-1).c);
  const m30 = resampleBars(bars, 30);
  assert.equal(m30.length, 46);
  assert.equal(nyLocal(m30[29].t).minute, 8 * 60 + 30);
  const h3 = resampleBars(bars, 180).map((b) => nyLocal(b.t).minute / 60);
  assert.deepEqual(h3, [18, 21, 0, 3, 6, 9, 12, 15]);
});

const arrowAt = (overrides = {}) => ({
  index: 0, t: SESSION_OPEN + 15 * 60 * MIN, closeT: SESSION_OPEN + 15.5 * 60 * MIN,
  side: 'LONG', entry: 21060, high: 21070, low: 21010, levelBelow: 21000, levelAbove: 21250, day: '2026-03-03', ...overrides,
});
const bar = (minutesAfterClose, h, l, c) => ({ t: SESSION_OPEN + 15.5 * 60 * MIN + minutesAfterClose * MIN, o: c, h, l, c, v: 1 });

test('long arrow wins when price reaches the opposite bank level before the wick stop', () => {
  const r = scoreArrow(arrowAt(), [bar(0, 21100, 21040, 21090), bar(5, 21260, 21080, 21240)], DEVIANT_V1, DEFAULT_SCORING);
  assert.equal(r.result, 'WIN');
  assert.equal(r.target, 21250);
  assert.equal(r.stop, 21010);
  assert.equal(r.r, Math.round((190 / 50) * 100) / 100);
  assert.equal(r.minutesToExit, 5);
});

test('stop first is a loss; stop and target in the same bar is a loss; nothing hit is open', () => {
  assert.equal(scoreArrow(arrowAt(), [bar(0, 21080, 21000, 21020), bar(1, 21300, 21000, 21290)], DEVIANT_V1, DEFAULT_SCORING).result, 'LOSS');
  assert.equal(scoreArrow(arrowAt(), [bar(0, 21300, 21000, 21100)], DEVIANT_V1, DEFAULT_SCORING).result, 'LOSS');
  const open = scoreArrow(arrowAt(), [bar(0, 21120, 21030, 21110)], DEVIANT_V1, DEFAULT_SCORING);
  assert.equal(open.result, 'OPEN');
  assert.equal(open.r, 1);
});

test('short arrow targets the bank level below; arrows closing after the exit hour have no time', () => {
  const short = arrowAt({ side: 'SHORT', entry: 21190, high: 21240, low: 21180, levelBelow: 21000, levelAbove: 21250 });
  assert.equal(scoreArrow(short, [bar(3, 21200, 20990, 21000)], DEVIANT_V1, DEFAULT_SCORING).result, 'WIN');
  const late = arrowAt({ closeT: SESSION_OPEN + 23 * 60 * MIN });
  assert.equal(scoreArrow(late, [], DEVIANT_V1, DEFAULT_SCORING).result, 'NO_TIME');
});

test('a day is won when one of its first two arrows reaches the opposite zone', () => {
  const mk = (t, result, day) => ({ ...arrowAt({ t, day }), stop: 0, target: 0, riskPts: 50, result, r: result === 'WIN' ? 3 : -1, mfeR: 0, maeR: 0, exitT: null, minutesToExit: 30 });
  const s = summarize([
    mk(1, 'LOSS', 'd1'), mk(2, 'WIN', 'd1'),
    mk(1, 'LOSS', 'd2'), mk(2, 'LOSS', 'd2'), mk(3, 'WIN', 'd2'),
  ], 10, DEFAULT_SCORING);
  assert.equal(s.daysWithArrows, 2);
  assert.equal(s.daysWon, 1);
  assert.equal(s.dayWinRate, 50);
  assert.equal(s.winRate, 40);
  assert.equal(s.totalR, 3);
});

test('full backtest runs from minute bars on the 30m timeframe and walks outcomes on 1m bars', () => {
  const bars = randomWalk(10 * 1440, 21000, 3, 40);
  const result = backtestArrows({ timeframeMinutes: 30, minuteBars: bars });
  assert.equal(result.timeframeMinutes, 30);
  assert.ok(result.chartBars > 0);
  assert.equal(result.summary.arrows, result.arrows.length);
  if (result.arrows.length) assert.equal(result.pathResolution, '1m');
  const tweaked = backtestArrows({ timeframeMinutes: 30, minuteBars: bars, params: { minCandleBody: 1e9 } });
  assert.equal(tweaked.summary.arrows, 0);
});
