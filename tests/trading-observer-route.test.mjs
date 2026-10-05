import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as frames from '../lib/trading-frame.ts';
import * as vision from '../lib/trading-vision.ts';

const at = '2026-09-24T16:00:00.000Z';
const later = (seconds) => new Date(Date.parse(at) + seconds * 1000).toISOString();
const draft = (changes = {}) => frames.normalizeFrameRead({
  brokerPanelVisible: true, positionStatus: 'UNKNOWN', intentState: 'PREPARING',
  symbol: 'MNQ', side: 'LONG', quantity: 2, orderType: 'LIMIT',
  entryPrice: 25000, currentPrice: 25005, stopPrice: 24990, targetPrice: 25020,
  confidence: .99, evidence: [], orderTicketVisible: true, ...changes,
});
const local = (extra = '') => 'JARVIS_OCR_EXECUTION|STATUS=PREPARING|SYMBOL=MNQ|SIDE=LONG|QTY=2|TYPE=LIMIT|ENTRY=25000' + extra;
const routeCode = ts.transpileModule(readFileSync(new URL('../app/api/trading/observe-frame/route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness({ generate, cacheFails = false } = {}) {
  const data = new Map();
  const jobs = [];
  const observations = [];
  const id = crypto.randomUUID();
  let state = { account: { connection: 'OBSERVING' }, observer: undefined, openTrades: [], today: {}, guardrails: {} };
  const cache = {
    async get(key) { if (cacheFails) throw Error('cache unavailable'); return data.get(key) ?? null; },
    async set(key, value) { if (cacheFails) throw Error('cache unavailable'); data.set(key, value); },
  };
  const mocks = {
    '../../../../lib/trading-frame': frames,
    '../../../../lib/trading-vision': vision,
    'next/server': { after: (task) => jobs.push(task) },
    '@vercel/functions': { getCache: () => cache },
    'ai': { generateText: generate ?? (async () => ({ text: JSON.stringify(draft()) })) },
    '@ai-sdk/openai': { openai: (model) => model },
    '../../../../lib/trading-device-link': {
      authenticateObserverDevice: async (_id, token) => token === 'test' ? { deviceId: id } : null,
      markObserverFrame: async () => {},
    },
    '../../../../lib/jarvis-models': { JARVIS_MODELS: { gatewayVision: 'gateway-test', claudeDeep: 'claude-test', gptStandard: 'gpt-test', gptFast: 'gpt-fast-test' } },
    '../../../../lib/trading-rules': {
      cachedTradingRules: () => ({ propFirm: 'Lucid Trading', accountLabel: 'CURRENT PROP ACCOUNT', maxTradesPerDay: 2, riskTargetDollars: 500, pointValues: {} }),
    },
    '../../../../lib/trading-runtime': {
      getTradingState: async () => state,
      ingestTradingObservation: async (input) => {
        observations.push(input);
        state = { ...state, account: { connection: input.connection, lastObservedAt: input.observedAt }, observer: input.observer };
        return state;
      },
    },
  };
  const exports = {};
  runInNewContext(routeCode, { exports, require: (name) => {
    assert.ok(name in mocks, `Unexpected dependency ${name}`);
    return mocks[name];
  }, process: { env: { OPENAI_API_KEY: 'test' } }, Response, Request, AbortSignal, AbortController, setTimeout, clearTimeout, console: { info() {}, warn() {}, error() {} } });
  async function post(text = '', seconds = 0, token = 'test') {
    return exports.POST(new Request('http://localhost/api/trading/observe-frame', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-jarvis-device-id': id },
      body: JSON.stringify({ imageBase64: 'test', semanticText: text, capturedAt: later(seconds), observerVersion: '0.4.15' }),
    }));
  }
  return { post, jobs, observations, data, state: () => state };
}

test('partial reads return before vision starts; another upload updates during slow vision', async () => {
  let finish;
  const h = harness({ generate: () => new Promise(resolve => { finish = resolve; }) });
  const first = await (await h.post(local())).json();
  assert.equal(first.accepted, true);
  assert.equal(first.frame.entryPrice, 25000);
  assert.equal(first.frame.targetPrice, null);
  assert.equal(h.jobs.length, 1);
  const background = h.jobs[0]();
  const next = await (await h.post(local('|STOP=24995'), 1)).json();
  assert.equal(next.frame.stopPrice, 24995);
  assert.equal(h.jobs.length, 1, 'one inspection while the first is pending');
  finish({ text: JSON.stringify(draft()) });
  await background;
  assert.equal(h.observations.length, 2, 'background never writes trading state');
  const third = await (await h.post(local('|STOP=24997'), 2)).json();
  assert.equal(third.frame.stopPrice, 24997);
  assert.equal(third.frame.targetPrice, 25020);
  assert.equal(third.frame.currentPrice, null, 'old cloud price is not refreshed');
});

test('cloud-only readings appear on the next upload with their screenshot time', async () => {
  const h = harness();
  assert.equal((await (await h.post()).json()).accepted, false);
  await h.jobs[0]();
  const response = await (await h.post('', 2)).json();
  assert.equal(response.source, 'cloud-vision');
  assert.equal(response.state.observer.observedAt, at);
  const held = await (await h.post('', 3)).json();
  assert.equal(held.accepted, false, 'same cloud frame is not applied twice');
  assert.equal(held.state.observer.observedAt, at);
});

test('cloud failure and cache failure do not suppress readable local facts', async () => {
  const h = harness({ generate: async () => { throw Error('provider unavailable'); } });
  await h.post(local());
  await h.jobs[0]();
  const next = await (await h.post(local('|STOP=24996'), 2)).json();
  assert.equal(next.accepted, true);
  assert.equal(next.state.connection, 'OBSERVING');
  assert.equal(next.frame.stopPrice, 24996);
  const unavailable = harness({ cacheFails: true });
  assert.equal((await (await unavailable.post(local())).json()).accepted, true);
  assert.equal(unavailable.jobs.length, 0);
});

test('late cloud OPEN cannot undo a newer explicit FLAT', async () => {
  let finish;
  const h = harness({ generate: () => new Promise(resolve => { finish = resolve; }) });
  await h.post('');
  const background = h.jobs[0]();
  const flat = await (await h.post('JARVIS_OCR_EXECUTION|STATUS=FLAT\nNo open positions', 1)).json();
  assert.equal(flat.frame.positionStatus, 'FLAT');
  finish({ text: JSON.stringify(draft({ positionStatus: 'OPEN', intentState: 'POSITION_OPEN' })) });
  await background;
  await h.post('', 2);
  assert.equal(h.state().observer.status, 'FLAT');
});

test('absence-only FLAT does not close a confirmed position', async () => {
  const h = harness();
  await h.post('JARVIS_OCR_EXECUTION|STATUS=OPEN|SYMBOL=MNQ|SIDE=LONG|QTY=2|ENTRY=25000');
  await h.post('JARVIS_OCR_EXECUTION|STATUS=FLAT', 1);
  assert.equal(h.state().observer.status, 'OPEN');
  assert.equal(h.state().observer.observedAt, at);
  await h.jobs[0]();
});

test('authentication is still required', async () => {
  const h = harness();
  assert.equal((await h.post(local(), 0, 'wrong')).status, 401);
  assert.equal(h.jobs.length, 0);
  assert.equal(h.observations.length, 0);
});

test('cached enrichment rejects another symbol, side, phase, size, entry, and expired data', () => {
  const partial = draft({ targetPrice: null });
  for (const change of [{ symbol: 'MGC' }, { side: 'SHORT' }, { intentState: 'ORDER_WORKING' }, { quantity: 3 }, { entryPrice: 25001 }]) {
    assert.equal(vision.enrichLocalFromVision(partial, { capturedAt: at, frame: draft(change), failed: false }, later(1)).targetPrice, null);
  }
  const result = { capturedAt: at, frame: draft(), failed: false };
  assert.equal(vision.enrichLocalFromVision(partial, result, later(6)).targetPrice, null);
  assert.equal(vision.enrichLocalFromVision(partial, result, later(-1)).targetPrice, null);
  assert.equal(vision.usableVision(result, later(46)), null);
  assert.equal(vision.usableVision({ ...result, frame: draft({ confidence: .4 }) }, later(1)), null);
});
