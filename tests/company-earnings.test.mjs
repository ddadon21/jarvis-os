import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatCompactUsd, payoutRowToRecord, summarizeLifetimeEarned, FUTURE_EARNED_SOURCES } from '../lib/company-earnings.ts';

// The four PAID rows currently stored in public.trading_payouts (issue #4).
const PAID_ROWS = [
  { id: 'p1', workspace_id: 'w', firm: 'Lucid Trading', payout_amount: 1051.85, status: 'PAID', approved_at: '2026-07-16T17:00:00Z' },
  { id: 'p2', workspace_id: 'w', firm: 'Lucid Trading', payout_amount: 803.93, status: 'PAID', approved_at: '2026-07-29T17:00:00Z' },
  { id: 'p3', workspace_id: 'w', firm: 'Lucid Trading', payout_amount: 901.0, status: 'PAID', approved_at: '2026-09-07T17:00:00Z' },
  { id: 'p4', workspace_id: 'w', firm: 'Topstep', payout_amount: '525.00', status: 'paid' },
];

function earned(rows, status = 'CONNECTED') {
  const payouts = { source: 'TRADING_PAYOUTS', label: 'Prop-firm trading payouts', status, priority: 10, records: rows.map(payoutRowToRecord).filter(Boolean) };
  return summarizeLifetimeEarned([payouts, ...FUTURE_EARNED_SOURCES], new Date('2026-10-06T12:00:00Z'));
}

test('lifetime earned totals the stored PAID payouts exactly and rounds to $3.3K', () => {
  const value = earned(PAID_ROWS);
  assert.equal(value.total, 3281.78);
  assert.equal(value.exact, '$3,281.78');
  assert.equal(value.display, '$3.3K');
  assert.equal(value.coverage, 'COMPLETE', 'sources that do not exist yet do not make it partial');
  assert.equal(value.counted.length, 4);
  assert.match(value.counted[0].evidence, /public\.trading_payouts\.payout_amount/);
});

test('a new PAID payout updates the total automatically', () => {
  const value = earned([...PAID_ROWS, { id: 'p5', firm: 'Lucid Trading', payout_amount: 1200, status: 'PAID' }]);
  assert.equal(value.total, 4481.78);
  assert.equal(value.display, '$4.5K');
});

test('unpaid, denied and cancelled payouts do not count', () => {
  const value = earned([
    ...PAID_ROWS,
    { id: 'a', payout_amount: 700, status: 'APPROVED' },
    { id: 'r', payout_amount: 700, status: 'REQUESTED' },
    { id: 'd', payout_amount: 700, status: 'DENIED' },
    { id: 'c', payout_amount: 700, status: 'CANCELLED' },
    { id: 'n', payout_amount: 700 },
  ]);
  assert.equal(value.total, 3281.78);
  assert.equal(value.excluded.unsettled, 5);
});

test('duplicates, transfers and invalid amounts are excluded', () => {
  const payouts = { source: 'TRADING_PAYOUTS', label: 'p', status: 'CONNECTED', priority: 10, records: [
    ...PAID_ROWS.map(payoutRowToRecord),
    { ...payoutRowToRecord(PAID_ROWS[0]) },                       // same row twice
    { ...payoutRowToRecord({ id: 'z', payout_amount: 0, status: 'PAID' }) },
  ] };
  payouts.records[0].dedupeKey = 'lucid-2026-07-16-1051.85';
  // The same real-world inflow later seen as a bank deposit, plus an own-account transfer.
  const deposits = { source: 'LIVE_TRADING_WITHDRAWALS', label: 'w', status: 'CONNECTED', priority: 20, records: [
    { id: 'dep1', source: 'LIVE_TRADING_WITHDRAWALS', kind: 'REVENUE', settled: true, amount: 1051.85, counterparty: 'Bank', occurredAt: null, dedupeKey: 'lucid-2026-07-16-1051.85', evidence: 'bank' },
    { id: 'xfer', source: 'LIVE_TRADING_WITHDRAWALS', kind: 'TRANSFER', settled: true, amount: 500, counterparty: 'Own savings', occurredAt: null, evidence: 'bank' },
  ] };
  const value = summarizeLifetimeEarned([deposits, payouts]);
  assert.equal(value.total, 3281.78);
  assert.deepEqual(value.excluded, { unsettled: 0, transfers: 1, duplicates: 2, invalid: 1 });
  assert.equal(value.sources.find((s) => s.source === 'TRADING_PAYOUTS').count, 4, 'the higher-priority source keeps the record');
});

test('an unreadable source is unavailable, never $0', () => {
  const value = earned([], 'UNAVAILABLE');
  assert.equal(value.total, null);
  assert.equal(value.display, '—');
  assert.equal(value.coverage, 'UNAVAILABLE');
  const partial = summarizeLifetimeEarned([
    { source: 'TRADING_PAYOUTS', label: 'p', status: 'CONNECTED', priority: 10, records: PAID_ROWS.map(payoutRowToRecord) },
    { source: 'SENTRYOPS_CONTRACTS', label: 's', status: 'UNAVAILABLE', priority: 30, records: [] },
  ]);
  assert.equal(partial.coverage, 'PARTIAL');
});

test('paid rows with an unrecognized amount column are UNAVAILABLE, never $0', () => {
  const all = earned([{ id: 'x1', payout: 900, status: 'PAID' }, { id: 'x2', payout: 525, status: 'PAID' }]);
  assert.equal(all.total, null);
  assert.equal(all.coverage, 'UNAVAILABLE');
  assert.match(all.sources[0].note, /2 paid records without a readable amount/);
  const some = earned([...PAID_ROWS, { id: 'x3', payout: 100, status: 'PAID' }]);
  assert.equal(some.total, 3281.78);
  assert.equal(some.coverage, 'PARTIAL');
});

test('payout rows resolve the amount column by name', () => {
  assert.equal(payoutRowToRecord({ id: 1, amount: 99.5, status: 'PAID' }).amount, 99.5);
  assert.equal(payoutRowToRecord({ id: 2, net_amount: '1,051.85', gross_amount: 1300, status: 'PAID' }).amount, 1051.85);
  assert.equal(payoutRowToRecord({ amount: 5 }), null, 'rows without an id are ignored');
  assert.equal(Number.isNaN(payoutRowToRecord({ id: 3, status: 'PAID' }).amount), true);
});

test('payout dates use the live column names ahead of the row insert time', () => {
  // Shape of the live public.trading_payouts rows: approval_date / request_date / created_at.
  const live = (id, approval, request) => ({
    id, firm: 'Lucid Trading', payout_amount: 901, status: 'PAID',
    approval_date: approval, request_date: request, created_at: '2026-09-26T15:00:00Z',
  });
  assert.equal(payoutRowToRecord(live('a', '2026-07-16', '2026-07-14')).occurredAt, '2026-07-16T00:00:00.000Z');
  assert.equal(payoutRowToRecord(live('b', null, '2026-07-28')).occurredAt, '2026-07-28T00:00:00.000Z', 'request_date when not yet approved');
  assert.equal(payoutRowToRecord(live('c', null, null)).occurredAt, '2026-09-26T15:00:00.000Z', 'created_at only as a last resort');
});

test('compact money format', () => {
  assert.equal(formatCompactUsd(3281.78), '$3.3K');
  assert.equal(formatCompactUsd(3249.99), '$3.2K');
  assert.equal(formatCompactUsd(950), '$950');
  assert.equal(formatCompactUsd(12_345), '$12.3K');
  assert.equal(formatCompactUsd(125_400), '$125K');
  assert.equal(formatCompactUsd(999_960), '$1.0M');
  assert.equal(formatCompactUsd(1_250_000), '$1.3M');
  assert.equal(formatCompactUsd(null), '—');
});

test('no hard-coded lifetime amount in the UI', () => {
  for (const file of ['../app/lifetime-earned.tsx', '../app/agents-floor.tsx', '../app/finance-cockpit-v2.tsx']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.equal(/3[.,]?[23]K|3,281|3281/.test(source), false, file);
  }
});
