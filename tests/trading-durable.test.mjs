import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionDay, pointValue, estimatePnl, nyMinuteOfDay } from '../lib/trading-session.ts';
import { diffTradingStates, changedTrades } from '../lib/trading-lifecycle.ts';

test('CME session day rolls at 18:00 New York, not UTC midnight', () => {
  // 2026-10-05 is a Monday. 19:30 ET Monday belongs to Tuesday's session.
  assert.equal(sessionDay('2026-10-05T23:30:00.000Z'), '2026-10-06');
  // 10:00 ET Monday is Monday.
  assert.equal(sessionDay('2026-10-05T14:00:00.000Z'), '2026-10-05');
  // 20:30 ET (00:30 UTC next day) is still the next session, not two days ahead.
  assert.equal(sessionDay('2026-10-06T00:30:00.000Z'), '2026-10-06');
  // Sunday evening open belongs to Monday.
  assert.equal(sessionDay('2026-10-04T22:30:00.000Z'), '2026-10-05');
  // Friday evening rolls to Monday.
  assert.equal(sessionDay('2026-10-09T22:30:00.000Z'), '2026-10-12');
});

test('NY minute of day handles daylight time', () => {
  assert.equal(nyMinuteOfDay('2026-10-05T13:30:00.000Z'), 9 * 60 + 30);
  assert.equal(nyMinuteOfDay('2026-12-07T14:30:00.000Z'), 9 * 60 + 30);
});

test('point values cover equity, energy and metals micros and minis', () => {
  assert.equal(pointValue('MNQZ6'), 2);
  assert.equal(pointValue('NQZ2026'), 20);
  assert.equal(pointValue('CME_MINI:ES1!'), 50);
  assert.equal(pointValue('MESZ6'), 5);
  assert.equal(pointValue('MYM'), 0.5);
  assert.equal(pointValue('M2K'), 5);
  assert.equal(pointValue('GCZ6'), 100);
  assert.equal(pointValue('UNKNOWN'), null);
  assert.equal(pointValue('MNQZ6', { MNQ: 2.5 }), 2.5);
});

test('estimated P&L respects side and size', () => {
  assert.equal(estimatePnl({ symbol: 'MNQ', side: 'LONG', quantity: 2, entryPrice: 21000, exitPrice: 21010.5 }), 42);
  assert.equal(estimatePnl({ symbol: 'ES', side: 'SHORT', quantity: 1, entryPrice: 6000, exitPrice: 6004 }), -200);
  assert.equal(estimatePnl({ symbol: 'MNQ', side: 'LONG', quantity: 2, entryPrice: 21000, exitPrice: null }), null);
});

const t0 = '2026-10-05T14:00:00.000Z';
const at = (s) => new Date(Date.parse(t0) + s * 1000).toISOString();
function state({ observer, open = [], closed = [] }) {
  return {
    version: 1,
    account: { connection: 'OBSERVING', lastObservedAt: observer?.observedAt ?? null },
    observer,
    openTrades: open,
    recentTrades: closed,
    guardrails: {},
    journalCount: open.length + closed.length,
    today: { trades: 0, wins: 0, losses: 0, realizedPnl: 0 },
    activeGoal: {},
    note: '',
  };
}
const obs = (o) => ({ status: 'FLAT', intentState: 'NONE', symbol: 'MNQ', side: null, quantity: null, entryPrice: null, stopPrice: null, targetPrice: null, openPnl: null, confidence: 0.9, evidence: [], ...o });
const trade = (o) => ({ id: 'T1', symbol: 'MNQ', side: 'LONG', quantity: 2, status: 'OPEN', entryPrice: 21000, exitPrice: null, stopPrice: 20980, targetPrice: 21040, openedAt: at(10), closedAt: null, realizedPnl: null, ...o });

test('full lifecycle produces prepare, entry, management and exit events', () => {
  const flat = state({ observer: obs({ observedAt: at(0) }) });
  const preparing = state({ observer: obs({ observedAt: at(5), intentState: 'PREPARING', side: 'LONG', quantity: 2, entryPrice: 21000 }) });
  const open = state({ observer: obs({ observedAt: at(10), status: 'OPEN', intentState: 'POSITION_OPEN', side: 'LONG', quantity: 2, entryPrice: 21000, stopPrice: 20980 }), open: [trade()] });
  const managed = state({ observer: obs({ observedAt: at(60), status: 'OPEN', intentState: 'POSITION_OPEN', side: 'LONG', quantity: 1, stopPrice: 21000 }), open: [trade({ quantity: 1, stopPrice: 21000 })] });
  const exited = state({ observer: obs({ observedAt: at(120) }), closed: [trade({ status: 'CLOSED', quantity: 1, exitPrice: 21030, closedAt: at(120), realizedPnl: 60 })] });

  assert.deepEqual(diffTradingStates(flat, preparing).map((e) => e.type), ['PREPARING']);
  assert.deepEqual(diffTradingStates(preparing, open).map((e) => e.type), ['ENTRY']);
  assert.deepEqual(diffTradingStates(open, managed).map((e) => e.type).sort(), ['SIZE_CHANGED', 'STOP_MOVED']);
  const exit = diffTradingStates(managed, exited);
  assert.deepEqual(exit.map((e) => e.type), ['EXIT']);
  assert.equal(exit[0].price, 21030);
  assert.equal(exit[0].payload.realizedPnl, 60);
});

test('a prepared order that disappears without a fill is recorded as cancelled', () => {
  const preparing = state({ observer: obs({ observedAt: at(5), intentState: 'PREPARING', side: 'SHORT' }) });
  const idle = state({ observer: obs({ observedAt: at(9) }) });
  assert.deepEqual(diffTradingStates(preparing, idle).map((e) => e.type), ['ORDER_CANCELLED']);
});

test('unchanged trades are not re-written', () => {
  const a = state({ observer: obs({ observedAt: at(10), status: 'OPEN' }), open: [trade()] });
  const b = state({ observer: obs({ observedAt: at(12), status: 'OPEN' }), open: [trade()] });
  assert.equal(changedTrades(a, b).length, 0);
  const c = state({ observer: obs({ observedAt: at(14), status: 'OPEN' }), open: [trade({ mfePrice: 21012 })] });
  assert.equal(changedTrades(b, c).length, 1);
});
