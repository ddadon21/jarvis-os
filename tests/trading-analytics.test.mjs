import test from 'node:test';
import assert from 'node:assert/strict';
import { tradeStats } from '../lib/trading-analytics.ts';

const t = (o) => ({ side: 'LONG', status: 'CLOSED', entry_price: 100, exit_price: 110, initial_stop: 95, initial_target: 115, opened_at: '2026-10-05T13:45:00Z', closed_at: '2026-10-05T14:05:00Z', prepared_at: '2026-10-05T13:44:30Z', realized_pnl: 20, mfe_price: 112, mae_price: 98, session_day: '2026-10-05', ...o });

test('R multiples, excursions and give-back', () => {
  const s = tradeStats([
    t({}),
    t({ exit_price: 95, realized_pnl: -10, mfe_price: 106, mae_price: 95 }),
    t({ side: 'SHORT', entry_price: 200, exit_price: 199, initial_stop: 205, mfe_price: 190, mae_price: 201, realized_pnl: 2, session_day: '2026-10-06', opened_at: '2026-10-06T15:10:00Z', closed_at: '2026-10-06T15:20:00Z' }),
  ]);
  assert.equal(s.trades, 3);
  assert.equal(s.sessions, 2);
  assert.equal(s.winRate, 0.667);
  assert.equal(s.avgR, round((2 - 1 + 0.2) / 3));
  assert.equal(s.gaveBackRate, 0.667, 'losing long reached +1.2R then stopped; short reached +2R then closed +0.2R');
  assert.equal(s.avgPrepSeconds, 30);
  assert.equal(s.bySide.SHORT.trades, 1);
  assert.deepEqual(s.byHour.map((h) => h.hour), [9, 11]);
});
function round(v) { return Math.round(v * 100) / 100; }
