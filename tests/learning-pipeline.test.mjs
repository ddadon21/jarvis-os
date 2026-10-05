import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFeatures, sessionKey, nyLocal, FEATURES } from '../lib/learning/features.ts';
import { ema, rma, cci, deviantHma, confirmedPivots } from '../lib/learning/indicators.ts';
import { runLearning, replayRules } from '../lib/learning/pipeline.ts';
import { simulateR } from '../lib/learning/evaluate.ts';

function rng(seed) {
  let a = seed;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Weekday sessions of 1m bars, 07:00-16:00 New York (EDT: 11:00-20:00 UTC). */
function syntheticBars(days, seed = 7) {
  const random = rng(seed);
  const bars = [];
  let price = 21000;
  let day = Date.UTC(2026, 5, 1); // Monday 2026-06-01
  let made = 0;
  while (made < days) {
    const weekday = new Date(day).getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      for (let m = 0; m < 540; m += 1) {
        const t = day + (11 * 60 + m) * 60_000;
        const drift = Math.sin((made * 540 + m) / 900) * 0.6;
        const o = price;
        const move = (random() - 0.5) * 12 + drift;
        let c = o + move;
        let h = Math.max(o, c) + random() * 4;
        let l = Math.min(o, c) - random() * 4;
        // Occasional liquidity sweeps: wick far beyond, close back.
        if (random() < 0.01) { l -= 25 + random() * 10; c = o + 6 + random() * 4; h = Math.max(h, c + 1); }
        if (random() < 0.01) { h += 25 + random() * 10; c = o - 6 - random() * 4; l = Math.min(l, c - 1); }
        bars.push({ t, o, h, l, c, v: 100 + Math.round(random() * 400) });
        price = c;
      }
      made += 1;
    }
    day += 86_400_000;
  }
  return bars;
}

test('Pine-compatible indicator seeds and math', () => {
  const src = [1, 2, 3, 4, 5, 6];
  const e = ema(src, 3);
  assert.ok(Number.isNaN(e[1]));
  assert.equal(e[2], 2); // seeded with SMA(1,2,3)
  assert.equal(e[3], 0.5 * 4 + 0.5 * 2);
  const r = rma(src, 3);
  assert.ok(Math.abs(r[3] - ((1 / 3) * 4 + (2 / 3) * 2)) < 1e-12);
  const c = cci([1, 2, 3, 4, 5, 6, 7, 8], 4);
  assert.ok(c[7] > 0);
  const h = deviantHma(Array.from({ length: 80 }, (_, i) => i), 34, 1.5);
  assert.ok(Math.abs(h[79] - 77) < 1e-9, 'DEVIANT HMA lags a straight line by exactly 2 bars (wma lag math)');
  const piv = confirmedPivots([1, 3, 1, 1, 1], [1, 1, 0, 1, 1], 1, 1);
  assert.ok(Number.isNaN(piv.lastHigh[1]), 'pivot not known before it is confirmed');
  assert.equal(piv.lastHigh[2], 3);
  assert.equal(piv.lastLow[3], 0);
});

test('session keys roll at 18:00 New York and minutes are local', () => {
  assert.equal(sessionKey(Date.UTC(2026, 9, 5, 21, 59)), '2026-10-05'); // 17:59 ET
  assert.equal(sessionKey(Date.UTC(2026, 9, 5, 22, 0)), '2026-10-06'); // 18:00 ET
  assert.equal(nyLocal(Date.UTC(2026, 9, 5, 13, 30)).minute, 9 * 60 + 30);
});

test('features never look ahead', () => {
  const bars = syntheticBars(6);
  const full = computeFeatures(bars);
  const cut = 2000;
  const partial = computeFeatures(bars.slice(0, cut + 1));
  for (const spec of FEATURES) {
    const a = full.columns[spec.name][cut];
    const b = partial.columns[spec.name][cut];
    assert.ok((Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) < 1e-9, `${spec.name} changed when future bars were added (${a} vs ${b})`);
  }
});

test('pipeline asks for more data when there are too few entries', () => {
  const bars = syntheticBars(5);
  const report = runLearning(bars, [{ id: 't1', symbol: 'MNQ', side: 'LONG', openedAt: new Date(bars[900].t + 90_000).toISOString(), preparedAt: null, closedAt: null, entryPrice: null, exitPrice: null, initialStop: null, initialTarget: null, realizedPnl: null }]);
  assert.equal(report.status, 'COLLECT_MORE');
  assert.equal(report.pine, null);
});

test('pipeline rediscovers a planted entry pattern and beats the baseline on unseen days', () => {
  const bars = syntheticBars(70);
  const frame = computeFeatures(bars);
  // "Dwight" buys right after a sweep-and-reclaim of the 60-bar low when the 1H trend is up,
  // and sells after a swept high when it is down. At most 2 a day, 15+ bars apart.
  const trades = [];
  let lastDay = '';
  let count = 0;
  let lastIndex = -1e9;
  for (let i = 0; i < frame.t.length; i += 1) {
    const day = frame.session[i];
    if (day !== lastDay) { lastDay = day; count = 0; }
    if (count >= 2 || i - lastIndex < 15 || frame.nyMinute[i] < 8 * 60 || frame.nyMinute[i] > 15 * 60) continue;
    const longSetup = frame.columns.swept_low_bars[i] === 0 && frame.columns.htf60_trend[i] > 0;
    const shortSetup = frame.columns.swept_high_bars[i] === 0 && frame.columns.htf60_trend[i] < 0;
    if (!longSetup && !shortSetup) continue;
    const side = longSetup ? 'LONG' : 'SHORT';
    const entry = frame.close[i];
    const stop = side === 'LONG' ? entry - 1.5 * frame.atr14[i] : entry + 1.5 * frame.atr14[i];
    trades.push({
      id: 'syn-' + i, symbol: 'MNQ', side,
      openedAt: new Date(frame.t[i] + 60_000 + 5_000).toISOString(), preparedAt: null, closedAt: null,
      entryPrice: entry, exitPrice: null, initialStop: stop, initialTarget: side === 'LONG' ? entry + 2 * (entry - stop) : entry - 2 * (stop - entry), realizedPnl: null,
    });
    count += 1;
    lastIndex = i;
  }
  assert.ok(trades.length >= 60, 'enough synthetic entries: ' + trades.length);

  const started = Date.now();
  const report = runLearning(bars, trades, { now: new Date('2026-10-05T22:00:00Z') });
  const elapsed = Date.now() - started;
  assert.equal(report.status, 'CANDIDATE', report.message + ' ' + JSON.stringify(report.metrics.test?.combined));
  const used = new Set(report.rules.flatMap((r) => r.conditions.map((c) => c.feature)));
  assert.ok(used.has('swept_low_bars') || used.has('swept_high_bars'), 'rules use the sweep feature: ' + [...used].join(','));
  assert.ok(report.metrics.test.combined.recall >= 0.4, 'test recall ' + report.metrics.test.combined.recall);
  assert.ok(report.metrics.test.combined.recall > (report.metrics.baselineTest?.combined.recall ?? 0));
  assert.ok(report.metrics.test.combined.signalsPerDay <= 2.01);
  assert.ok(Math.abs(report.data.risk.stopAtr - 1.5) < 0.01, 'risk model learned from initial stops');
  assert.ok(elapsed < 30_000, 'runs fast enough for a serverless function: ' + elapsed + 'ms');

  const pine = report.pine;
  assert.match(pine, /^\/\/@version=6/);
  assert.match(pine, /indicator\("DEVIANT - LEARNED v20261005-2200"/);
  assert.match(pine, /color\.new\(color\.blue, 0\)/);
  assert.match(pine, /color\.new\(color\.black, 0\)/);
  assert.match(pine, /f_swept_(low|high)_bars = /);
  assert.doesNotMatch(pine, /plot\(/, 'arrows only: no plotted lines');

  const replay = replayRules(bars, report.rules, report.policy);
  assert.ok(replay.length > 0, 'stored rules replay into signals');
});

test('outcome simulation assumes the stop first when one bar hits both', () => {
  const frame = {
    t: [0, 60_000], open: [100, 100], close: [100, 100], high: [100, 200], low: [100, 0],
    atr14: [10, 10], nyMinute: [600, 601], session: ['d', 'd'], columns: {},
  };
  assert.equal(simulateR(frame, { index: 0, side: 'LONG' }, { stopAtr: 1, targetR: 2, samples: 1 }), -1);
});
