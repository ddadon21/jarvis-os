import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as math from '../lib/finance-math.ts';
import { FINANCE_IMPORT } from '../lib/finance-import.ts';
import { deriveFinanceFocus } from '../lib/finance-focus.ts';

const totals = math.financeTotals(FINANCE_IMPORT.accounts);
// Expected values are recomputed independently from the snapshot so a balance refresh
// (lib/finance-import.ts) does not break the reconciliation checks.
const c = (n) => Math.round(n * 100);
const sumOf = (items, field = 'current') => items.reduce((n, a) => n + c(a[field] ?? 0), 0) / 100;
const banks = FINANCE_IMPORT.accounts.filter(a => a.type === 'depository');
const debts = FINANCE_IMPORT.accounts.filter(a => a.type === 'credit' || a.type === 'loan');
const owed = (items) => items.reduce((n, a) => n + c(Math.max(0, a.current)), 0) / 100;
const expected = {
  liquidity: sumOf(banks),
  availableCash: sumOf(banks, 'available'),
  businessCash: sumOf(banks.filter(a => a.ownership === 'BUSINESS')),
  personalDebt: owed(debts.filter(a => a.ownership !== 'AUTHORIZED_USER')),
  investmentValue: sumOf(FINANCE_IMPORT.accounts.filter(a => a.type === 'investment')),
  authorizedUserBalance: owed(debts.filter(a => a.ownership === 'AUTHORIZED_USER')),
};
expected.personalNetWorth = (c(expected.liquidity) + c(expected.investmentValue) - c(expected.personalDebt)) / 100;
expected.providerNetWorth = (c(expected.personalNetWorth) - c(expected.authorizedUserBalance)) / 100;
test('refreshed balances reconcile with available cash and separate AU debt', () => {
  assert.ok(banks.length > 0 && debts.length > 0, 'snapshot has bank and debt accounts');
  for (const [key, value] of Object.entries(expected)) assert.equal(totals[key], value, key);
  assert.ok(totals.authorizedUserBalance > 0, 'authorized-user debt is tracked separately');
  assert.equal(totals.providerNetWorth, (c(totals.personalNetWorth) - c(totals.authorizedUserBalance)) / 100);
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
  assert.equal(next.metrics.liquidity, expected.liquidity);
  assert.equal(next.asOf, FINANCE_IMPORT.asOf);
  assert.equal(next.accounts.find(a => a.key === 'bofa-business').available, FINANCE_IMPORT.accounts.find(a => a.key === 'bofa-business').available);
  assert.equal(next.accounts[0].balanceFreshness, 'unknown');
  const newer = { ...FINANCE_IMPORT, mode: 'DIRECT', asOf: new Date(Date.parse(FINANCE_IMPORT.asOf) + 86_400_000).toISOString(), accounts: [{ ...FINANCE_IMPORT.accounts[0], current: 1000 }] };
  const kept = await runtime(newer).getOrSeedFinanceState();
  assert.equal(kept.mode, 'DIRECT');
  assert.equal(kept.metrics.liquidity, 1000);
});
