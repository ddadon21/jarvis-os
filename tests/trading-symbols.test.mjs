import test from 'node:test';
import assert from 'node:assert/strict';
import { symbolRoot, priceFamily } from '../lib/trading-symbols.ts';

test('symbol roots across TradingView and Tradovate spellings', () => {
  assert.equal(symbolRoot('CME_MINI:NQ1!'), 'NQ');
  assert.equal(symbolRoot('NQZ2026'), 'NQ');
  assert.equal(symbolRoot('MNQZ6'), 'MNQ');
  assert.equal(symbolRoot('mes1!'), 'MES');
  assert.equal(symbolRoot('CBOT_MINI:YM1!'), 'YM');
  assert.equal(symbolRoot('ZBZ2026'), 'ZB');
  assert.equal(symbolRoot(''), null);
});

test('micros and minis share a price family', () => {
  assert.equal(priceFamily('MNQZ6'), 'NQ');
  assert.equal(priceFamily('CME_MINI:NQ1!'), 'NQ');
  assert.equal(priceFamily('MES'), 'ES');
  assert.equal(priceFamily('M2K'), 'RTY');
});
