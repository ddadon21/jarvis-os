import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDeal, checkCriteria, verdict, criteriaSetCount, EMPTY_CRITERIA, EMPTY_DEAL } from '../lib/real-estate-math.ts';

const deal = { ...EMPTY_DEAL, address: '12 Oak St', area: 'San Antonio', propertyType: 'SINGLE FAMILY', purchasePrice: '150000', arv: '260000', rehab: '40000', holdingMonths: '4', monthlyHolding: '1000', buyClosingPercent: '2', sellCostPercent: '8', financingCost: '5000', beds: '3', baths: '2' };

test('profit, ROI and max offer follow the flip formula', () => {
  const r = analyzeDeal(deal, 70);
  assert.equal(r.buyClosing, 3000);
  assert.equal(r.holding, 4000);
  assert.equal(r.sellCosts, 20800);
  assert.equal(r.cashInvested, 202000);
  assert.equal(r.profit, 260000 - 202000 - 20800);
  assert.equal(r.roi, Math.round(37200 / 202000 * 10000) / 100);
  assert.equal(r.maxOffer, 260000 * 0.7 - 40000);
  assert.equal(r.arvPercent, Math.round(190000 / 260000 * 10000) / 100);
});

test('missing core numbers are reported, not treated as zero profit', () => {
  const r = analyzeDeal({ ...deal, arv: '' });
  assert.equal(r.ready, false);
  assert.deepEqual(r.missing, ['ARV']);
});

test('blank criteria are skipped; set criteria pass or fail', () => {
  assert.equal(verdict(checkCriteria(deal, EMPTY_CRITERIA)), 'NO CRITERIA');
  assert.equal(criteriaSetCount(EMPTY_CRITERIA), 0);
  const criteria = { ...EMPTY_CRITERIA, areas: 'san antonio, 78201', maxPrice: '200000', minProfit: '30000', maxArvPercent: '75', propertyTypes: ['SINGLE FAMILY'] };
  assert.equal(criteriaSetCount(criteria), 5);
  assert.equal(verdict(checkCriteria(deal, criteria)), 'PASS');
  assert.equal(verdict(checkCriteria({ ...deal, purchasePrice: '210000' }, criteria)), 'FAIL');
  assert.equal(verdict(checkCriteria({ ...deal, area: 'Austin', address: '1 Elm' }, criteria)), 'FAIL');
  assert.equal(verdict(checkCriteria({ ...deal, propertyType: '' }, criteria)), 'UNKNOWN');
});
