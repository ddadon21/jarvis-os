import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTradingViewCsv, parseMarketWebhook } from '../lib/learning/csv.ts';

test('TradingView CSV with unix seconds', () => {
  const csv = 'time,open,high,low,close,Volume,EMA\n1759670400,100,101,99,100.5,12,1\n1759670460,100.5,102,100,101,8,1\nbad,row\n';
  const { bars, skipped, timeframeMinutes } = parseTradingViewCsv(csv);
  assert.equal(bars.length, 2);
  assert.equal(skipped, 1);
  assert.equal(bars[0].t, 1759670400000);
  assert.equal(timeframeMinutes, 1);
});

test('TradingView CSV with ISO times and BOM', () => {
  const { bars } = parseTradingViewCsv('﻿time,open,high,low,close\n2026-10-05T13:31:00Z,1,2,0.5,1.5\n2026-10-05T13:30:00Z,1,2,0.5,1\n');
  assert.equal(bars.length, 2);
  assert.ok(bars[0].t < bars[1].t, 'sorted');
});

test('CSV without required columns is rejected', () => {
  assert.throws(() => parseTradingViewCsv('date,price\n1,2\n'));
});

test('webhook bar and signal payloads', () => {
  const bar = parseMarketWebhook({ kind: 'bar', symbol: 'NQ1!', timeframe: '1', time: 1759670400000, open: '100', high: 101, low: 99, close: 100.5, volume: 5 });
  assert.equal(bar.kind, 'bar');
  assert.equal(bar.bar.o, 100);
  const signal = parseMarketWebhook({ kind: 'signal', model: 'v1', symbol: 'MNQ1!', side: 'LONG', time: 1759670400000, price: 21000 });
  assert.equal(signal.side, 'LONG');
  assert.equal(parseMarketWebhook({ kind: 'bar', symbol: 'NQ', time: 1, open: 1, high: 0, low: 2, close: 1 }), null, 'high < low rejected');
  assert.equal(parseMarketWebhook({ kind: 'signal', symbol: 'NQ', side: 'UP', time: 1, model: 'x' }), null);
});
