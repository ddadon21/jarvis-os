import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { observerPhase, nextFilledAt, gateOpenRead, OBSERVER_PHASES, ORDER_FILLED_HOLD_MS, OPEN_CONFIRM_WINDOW_MS, phaseLabel } from '../lib/trading-phase.ts';

const now = Date.parse('2026-10-06T14:00:10.000Z');

test('exactly five external phases', () => {
  assert.deepEqual([...OBSERVER_PHASES], ['WAITING', 'PREPARING_ORDER', 'PENDING_ORDER', 'ORDER_FILLED', 'TRADE_IN_PROGRESS']);
  assert.equal(phaseLabel('PENDING_ORDER'), 'PENDING ORDER');
});

test('phase mapping from fused observer state', () => {
  assert.equal(observerPhase(null, now), 'WAITING');
  assert.equal(observerPhase({ status: 'FLAT', intentState: 'NONE' }, now), 'WAITING');
  assert.equal(observerPhase({ status: 'UNKNOWN', intentState: 'UNKNOWN' }, now), 'WAITING');
  assert.equal(observerPhase({ status: 'UNKNOWN', intentState: 'PREPARING' }, now), 'PREPARING_ORDER');
  // A working order is no longer collapsed into "preparing".
  assert.equal(observerPhase({ status: 'PENDING', intentState: 'ORDER_WORKING' }, now), 'PENDING_ORDER');
  assert.equal(observerPhase({ status: 'UNKNOWN', intentState: 'ORDER_WORKING' }, now), 'PENDING_ORDER');
});

test('ORDER_FILLED is a short transient, then TRADE_IN_PROGRESS', () => {
  const filledAt = new Date(now - 1_000).toISOString();
  assert.equal(observerPhase({ status: 'OPEN', intentState: 'POSITION_OPEN', filledAt }, now), 'ORDER_FILLED');
  assert.equal(observerPhase({ status: 'OPEN', intentState: 'POSITION_OPEN', filledAt }, now + ORDER_FILLED_HOLD_MS), 'TRADE_IN_PROGRESS');
  assert.equal(observerPhase({ status: 'OPEN', intentState: 'POSITION_OPEN', filledAt: null }, now), 'TRADE_IN_PROGRESS');
  // An open position outranks a draft being edited on top of it.
  assert.equal(observerPhase({ status: 'OPEN', intentState: 'PREPARING', filledAt: null }, now), 'TRADE_IN_PROGRESS');
});

test('filledAt is set on the fill, kept while open, cleared when flat', () => {
  const t1 = '2026-10-06T14:00:00.000Z';
  const t2 = '2026-10-06T14:00:05.000Z';
  assert.equal(nextFilledAt({ status: 'PENDING', filledAt: null }, 'OPEN', t1), t1);
  assert.equal(nextFilledAt({ status: 'OPEN', filledAt: t1 }, 'OPEN', t2), t1);
  assert.equal(nextFilledAt({ status: 'OPEN', filledAt: t1 }, 'FLAT', t2), null);
  assert.equal(nextFilledAt(undefined, 'PENDING', t2), null);
});

function loadDiagnostics() {
  const source = readFileSync(new URL('../lib/observer-diagnostics.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  runInNewContext(code, { exports, require: (name) => {
    if (name === './jarvis-db') return { durableRead: async () => null, durableWrite: async () => true };
    throw new Error('Unexpected require: ' + name);
  } });
  return exports;
}

test('diagnostics uploads are validated and bounded', () => {
  const { normalizeObserverDiagnostics } = loadDiagnostics();
  assert.equal(normalizeObserverDiagnostics(null, 'dev'), null);
  assert.equal(normalizeObserverDiagnostics({ day: 'yesterday' }, 'dev'), null);
  const value = normalizeObserverDiagnostics({
    day: '2026-10-06', observerVersion: '1.1.0', generatedAt: '2026-10-06T20:00:00Z', reads: 1200, readMsP95: 310.44, activeReads: 90,
    missingFieldRate: { symbol: 0, stop: 0.25, bogus: 9, target: 4 }, wrongSymbolRate: 0.02, titleComparableReads: 80,
    suspectedFalseOrderEvents: 1, suspectedFalseTrades: -3, cancelClears: 4, cancelClearMsP95: 1800,
    transitions: { 'WAITING>PENDING_ORDER': 3, '<script>': 1 },
    perSymbol: { MNQ: { activeReads: 50, completeReads: 44, episodes: 3, fills: 1, suspect: 0 }, 'bad symbol!': { activeReads: 1 } },
  }, 'dev-1', '2026-10-06T20:01:00.000Z');
  assert.equal(value.day, '2026-10-06');
  assert.equal(value.deviceId, 'dev-1');
  assert.equal(value.readMsP95, 310.4);
  assert.equal(value.missingFieldRate.stop, 0.25);
  assert.equal(value.missingFieldRate.target, null, 'rates above 1 are rejected');
  assert.equal('bogus' in value.missingFieldRate, false);
  assert.equal(value.suspectedFalseTrades, 0, 'negative counts are clamped');
  assert.deepEqual(Object.keys(value.transitions), ['WAITING>PENDING_ORDER']);
  assert.deepEqual(Object.keys(value.perSymbol), ['MNQ']);
});

// Mirrors normalizeObserver in lib/trading-runtime.ts: every web read is gated, then filledAt is derived.
function serverRead(previous, read, at) {
  const gated = gateOpenRead({ status: read.status, intentState: read.intentState, symbol: read.symbol ?? null, side: read.side ?? null }, previous, at);
  return { ...read, status: gated.status, intentState: gated.intentState, openCandidate: gated.openCandidate, filledAt: nextFilledAt(previous, gated.status, at), observedAt: at };
}
const t = (ms) => new Date(Date.parse('2026-10-06T14:00:00.000Z') + ms).toISOString();
const pending = { status: 'PENDING', intentState: 'ORDER_WORKING', symbol: 'MNQZ2026', side: 'LONG' };
const open = { status: 'OPEN', intentState: 'POSITION_OPEN', symbol: 'MNQZ2026', side: 'LONG' };
const flat = { status: 'FLAT', intentState: 'NONE', symbol: 'MNQZ2026', side: null };

test('one false OPEN read never shows ORDER_FILLED or TRADE_IN_PROGRESS on the web', () => {
  let s1 = serverRead(undefined, pending, t(0));
  assert.equal(observerPhase(s1, Date.parse(t(0))), 'PENDING_ORDER', 'pending stays immediate');
  const s2 = serverRead(s1, open, t(650));                 // single bad OPEN read
  assert.equal(observerPhase(s2, Date.parse(t(650))), 'PENDING_ORDER');
  assert.equal(s2.filledAt, null);
  const s3 = serverRead(s2, pending, t(1300));             // the next read disagrees: candidate dropped
  assert.equal(observerPhase(s3, Date.parse(t(1300))), 'PENDING_ORDER');
  assert.equal(s3.openCandidate, null);
  const s4 = serverRead(s3, open, t(1950));                // a later lone OPEN is again only a candidate
  assert.equal(observerPhase(s4, Date.parse(t(1950))), 'PENDING_ORDER');
});

test('two coherent OPEN reads promote to ORDER_FILLED, then TRADE_IN_PROGRESS', () => {
  const s1 = serverRead(serverRead(undefined, pending, t(0)), open, t(650));
  const s2 = serverRead(s1, open, t(1300));
  assert.equal(s2.status, 'OPEN');
  assert.equal(s2.filledAt, t(1300), 'fill time is the confirming read');
  assert.equal(observerPhase(s2, Date.parse(t(1300))), 'ORDER_FILLED');
  const s3 = serverRead(s2, open, t(1300 + ORDER_FILLED_HOLD_MS));
  assert.equal(observerPhase(s3, Date.parse(t(1300 + ORDER_FILLED_HOLD_MS))), 'TRADE_IN_PROGRESS');
});

test('the confirmation must be coherent, newer and within the window', () => {
  const s1 = serverRead(serverRead(undefined, pending, t(0)), open, t(650));
  assert.notEqual(serverRead(s1, { ...open, symbol: 'ESZ2026' }, t(1300)).status, 'OPEN', 'different symbol');
  assert.notEqual(serverRead(s1, { ...open, side: 'SHORT' }, t(1300)).status, 'OPEN', 'different side');
  assert.notEqual(serverRead(s1, open, t(650)).status, 'OPEN', 'the same (cached) read cannot confirm itself');
  assert.notEqual(serverRead(s1, open, t(650 + OPEN_CONFIRM_WINDOW_MS + 1)).status, 'OPEN', 'too far apart');
  // A carry-over of the held state (inconclusive upload, older timestamp) keeps the candidate.
  const carried = serverRead(s1, { ...s1 }, t(650));
  assert.deepEqual(carried.openCandidate, s1.openCandidate);
  assert.equal(serverRead(carried, open, t(1300)).status, 'OPEN');
});

test('PREPARING and an already-open position are not delayed by the gate', () => {
  const prep = serverRead(undefined, { status: 'UNKNOWN', intentState: 'PREPARING', symbol: 'GCZ2026', side: 'SHORT' }, t(0));
  assert.equal(observerPhase(prep, Date.parse(t(0))), 'PREPARING_ORDER');
  const confirmed = serverRead(serverRead(serverRead(undefined, pending, t(0)), open, t(650)), open, t(1300));
  const next = serverRead(confirmed, open, t(1950));
  assert.equal(next.status, 'OPEN');
  assert.equal(next.filledAt, t(1300));
  assert.equal(observerPhase(serverRead(next, flat, t(2600)), Date.parse(t(2600))), 'WAITING', 'a flat read still clears');
});

test('every web observation path goes through the confirmed-fill gate', () => {
  const runtime = readFileSync(new URL('../lib/trading-runtime.ts', import.meta.url), 'utf8');
  const normalize = runtime.slice(runtime.indexOf('function normalizeObserver('));
  assert.match(normalize, /gateOpenRead\(/);
  assert.match(normalize, /const status = gated\.status;/);
  assert.match(normalize, /intentState: gated\.intentState,/);
  // ingestTradingObservation (observe-frame local/cloud paths and /ingest) builds observers only via normalizeObserver.
  assert.equal((runtime.match(/normalizeObserver\(/g) ?? []).length, 2, 'one definition, one call site');
});
