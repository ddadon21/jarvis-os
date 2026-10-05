import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as session from '../lib/trading-session.ts';

function load(path, mocks) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  runInNewContext(code, { exports, require: (name) => { assert.ok(name in mocks, 'unexpected ' + name); return mocks[name]; } });
  return exports;
}
const sync = load('../lib/trading-journal-sync.ts', { './trading-session': session });

const base = { symbol: 'MNQ', side: 'LONG', quantity: 2, currentPrice: null, pnl: null };
const ev = (o) => sync.normalizeJournalEvent({ ...base, id: 'e' + Math.random(), tradeId: 'T1', payload: {}, ...o });

test('normalize rejects malformed events', () => {
  assert.equal(sync.normalizeJournalEvent({ id: 'x', type: 'NOPE', at: '2026-10-05T14:00:00Z' }), null);
  assert.equal(sync.normalizeJournalEvent({ id: 'x', type: 'ENTRY', at: 'not a date' }), null);
  assert.equal(sync.normalizeJournalEvent(null), null);
});

test('entry then exit folds into one closed trade with observed P&L', () => {
  const patches = sync.journalEventsToTradePatches([
    ev({ type: 'ENTRY', at: '2026-10-05T14:00:10Z', price: 21000, stopPrice: 20980, targetPrice: 21040, payload: { preparedAt: '2026-10-05T14:00:01Z' } }),
    ev({ type: 'STOP_MOVED', at: '2026-10-05T14:00:40Z', stopPrice: 21000 }),
    ev({ type: 'EXIT', at: '2026-10-05T14:01:00Z', price: 21030, stopPrice: 21000, targetPrice: 21040, payload: { realizedPnl: 120, entryPrice: 21000, openedAt: '2026-10-05T14:00:10Z', initialStop: 20980, maxQuantity: 2, mfePrice: 21030, maePrice: 20990 } }),
  ]);
  assert.equal(patches.length, 1);
  const row = patches[0];
  assert.equal(row.status, 'CLOSED');
  assert.equal(row.realized_pnl, 120);
  assert.equal(row.pnl_source, 'OBSERVED');
  assert.equal(row.initial_stop, 20980);
  assert.equal(row.stop_price, 21000);
  assert.equal(row.prepared_at, '2026-10-05T14:00:01.000Z');
  assert.equal(row.session_day, '2026-10-05');
});

test('exit without visible P&L is estimated from points and contract value', () => {
  const [row] = sync.journalEventsToTradePatches([
    ev({ type: 'EXIT', at: '2026-10-05T14:01:00Z', price: 21010, payload: { entryPrice: 21000, openedAt: '2026-10-05T14:00:00Z', maxQuantity: 2 } }),
  ]);
  assert.equal(row.realized_pnl, 40);
  assert.equal(row.pnl_source, 'ESTIMATED');
  assert.equal(typeof row.opened_at, 'string', 'exit alone yields a complete row');
});

test('management-only batch produces a partial patch (update, not insert)', () => {
  const [row] = sync.journalEventsToTradePatches([ev({ type: 'TARGET_MOVED', at: '2026-10-05T14:00:50Z', targetPrice: 21060 })]);
  assert.equal(row.target_price, 21060);
  assert.equal(row.opened_at, undefined);
});
