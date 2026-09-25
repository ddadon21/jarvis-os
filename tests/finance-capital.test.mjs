import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as math from '../lib/finance-math.ts';
import { FINANCE_IMPORT } from '../lib/finance-import.ts';
import { deriveFinanceFocus } from '../lib/finance-focus.ts';

const totals = math.financeTotals(FINANCE_IMPORT.accounts);
test('refreshed balances reconcile with available cash and separate AU debt', () => {
  assert.equal(totals.liquidity, 538.70);
  assert.equal(totals.availableCash, 14.34);
  assert.equal(totals.businessCash, 528.10);
  assert.equal(totals.personalDebt, 1138.31);
  assert.equal(totals.investmentValue, 1.78);
  assert.equal(totals.authorizedUserBalance, 8205.97);
  assert.equal(totals.personalNetWorth, -597.83);
  assert.equal(totals.providerNetWorth, -8803.80);
});
test('missing available balance is unknown, not replaced with current balance', () => {
  const accounts = FINANCE_IMPORT.accounts.map(a => a.key === 'bofa-business' ? { ...a, available: null } : a);
  assert.equal(math.financeTotals(accounts).availableCash, null);
  assert.equal(math.financeTotals(accounts).missingAvailable, 1);
});
test('overdrafts reduce cash and net worth instead of disappearing', () => {
  const account = { ...FINANCE_IMPORT.accounts[0], current: -20, available: -25 };
  assert.equal(math.financeTotals([account]).personalNetWorth, -20);
  assert.equal(math.financeTotals([account]).availableCash, -25);
});
test('payout allocation is cent-accurate and leaves actual balances unchanged', () => {
  const before = JSON.stringify(FINANCE_IMPORT);
  const p = { ...math.EMPTY_PAYOUT_PLAN, payout: '810', tax: '100', bills: '92', reserve: '118', debt: '300', business: '200', target: 'rbfcu-world' };
  const result = math.payoutMath(p, 598.12);
  assert.equal(result.error, null);
  assert.equal(result.remaining, 0);
  assert.equal(result.projectedDebt, 298.12);
  assert.equal(JSON.stringify(FINANCE_IMPORT), before);
  assert.equal(math.payoutMath({ ...p, payout: '.3' }, 598.12).error != null, true);
  assert.equal(math.payoutMath({ ...math.EMPTY_PAYOUT_PLAN, payout: '0.30', tax: '0.10', bills: '0.20' }, null).remaining, 0);
});
test('over-allocation, missing debt target, overpayment, negatives and malformed amounts are blocked', () => {
  const p = { ...math.EMPTY_PAYOUT_PLAN, payout: '100' };
  for (const [changes, balance] of [[{ debt: '101' }, 500], [{ debt: '50' }, null], [{ debt: '50' }, 20], [{ reserve: '-1' }, null], [{ payout: 'Infinity' }, null], [{ tax: '0.001' }, null], [{ payout: '1e5' }, null]]) {
    assert.ok(math.payoutMath({ ...p, ...changes }, balance).error);
  }
});
test('unknown APR prevents an unsupported cheapest payoff order', () => {
  const focus = deriveFinanceFocus({ ...FINANCE_IMPORT, metrics: totals });
  assert.match(focus.targetLabel, /VERIFY/);
  assert.match(focus.nextStep, /QUICKSILVER/);
});

const code = ts.transpileModule(readFileSync(new URL('../lib/finance-live.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function runtime(existing) {
  let state = existing;
  const modules = {
    './finance-import': { FINANCE_IMPORT }, './finance-math': math,
    './jarvis-runtime': { getFinanceState: async () => state, setFinanceState: async x => { state = x; }, appendRuntimeEvent: async () => {}, createRuntimeEvent: x => x },
  };
  const exports = {};
  runInNewContext(code, { exports, require: name => { assert.ok(name in modules); return modules[name]; } });
  return exports;
}
test('new import replaces stale snapshot cache but preserves newer account updates', async () => {
  const old = { ...FINANCE_IMPORT, asOf: '2026-09-19T19:25:00Z', accounts: [{ ...FINANCE_IMPORT.accounts[0], current: 999 }] };
  const next = await runtime(old).getOrSeedFinanceState();
  assert.equal(next.metrics.liquidity, 538.70);
  assert.equal(next.asOf, FINANCE_IMPORT.asOf);
  assert.equal(next.accounts.find(a => a.key === 'bofa-business').available, 4.74);
  assert.equal(next.accounts[0].balanceFreshness, 'unknown');
  const newer = { ...FINANCE_IMPORT, mode: 'DIRECT', asOf: '2026-09-26T04:00:00Z', accounts: [{ ...FINANCE_IMPORT.accounts[0], current: 1000 }] };
  const kept = await runtime(newer).getOrSeedFinanceState();
  assert.equal(kept.mode, 'DIRECT');
  assert.equal(kept.metrics.liquidity, 1000);
});
