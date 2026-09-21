import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectOcrLayoutExecution, executionOcrDiagnostics, inspectLocalOcrExecution, inspectSemanticExecution, fuseExecutionReads, isRichExecutionRead, mergeSemanticWithPrevious, mergeVisualWithSemantic, normalizeFrameRead } from '../lib/trading-frame.ts';

const at = '2026-09-20T20:00:00.000Z';
function draft(overrides = {}) {
  return normalizeFrameRead({ brokerPanelVisible: true, positionStatus: 'UNKNOWN', intentState: 'PREPARING', orderTicketVisible: true,
    symbol: 'MNQ', side: 'LONG', quantity: 10, orderType: 'LIMIT', entryPrice: 29733.75,
    currentPrice: 29960.25, stopPrice: 29708.5, targetPrice: 29948.75, confidence: .99, evidence: [], ...overrides });
}
function prior(frame, time = at) { return { ...frame, status: frame.positionStatus, observedAt: time }; }

for (const symbol of ['NQ', 'MNQ', 'YM', 'MYM', 'ES', 'MES', 'GC', 'MGC']) {
  for (const side of ['LONG', 'SHORT']) {
    test(`${symbol} ${side} unplaced draft retains all eight fields`, () => {
      const text = `JARVIS_OCR_EXECUTION|STATUS=PREPARING|SYMBOL=${symbol}|SIDE=${side}|QTY=10|TYPE=LIMIT|ENTRY=3000|CURRENT=3010|STOP=${side === 'LONG' ? 2990 : 3015}|TARGET=${side === 'LONG' ? 3040 : 2950}`;
      const frame = inspectLocalOcrExecution(text).frame;
      assert.equal(frame.intentState, 'PREPARING');
      assert.equal(frame.positionStatus, 'UNKNOWN');
      assert.equal(frame.symbol, symbol);
      assert.equal(isRichExecutionRead(frame), true);
    });
  }
}
test('partial reads still request vision completion', () => {
  assert.equal(isRichExecutionRead(draft({ currentPrice: null, targetPrice: null })), false);
});
test('unsubmitted draft with a Cancel control stays preparing', () => {
  const frame = inspectSemanticExecution('button | Buy 10 MNQZ2026 @ 29,733.75 limit\nbutton | Change order quantity\nbutton | Cancel project order').frame;
  assert.equal(frame.intentState, 'PREPARING');
  assert.equal(frame.quantity, 10);
  assert.equal(frame.entryPrice, 29733.75);
});
test('partial quantity and moved stop replace old richer facts', () => {
  const old = prior(draft({ positionStatus: 'OPEN', intentState: 'POSITION_OPEN' }));
  const frame = mergeSemanticWithPrevious(draft({ positionStatus: 'OPEN', intentState: 'POSITION_OPEN', quantity: 4, stopPrice: 29720, targetPrice: null }), old, '2026-09-20T20:00:01Z');
  assert.equal(frame.quantity, 4);
  assert.equal(frame.stopPrice, 29720);
  assert.equal(frame.targetPrice, 29948.75);
});
test('temporary missing draft detail can use the same fresh draft', () => {
  const frame = mergeSemanticWithPrevious(draft({ targetPrice: null, currentPrice: null }), prior(draft()), '2026-09-20T20:00:01Z');
  assert.equal(frame.targetPrice, 29948.75);
  assert.equal(frame.currentPrice, null);
});
test('changed instrument and expired readings cannot donate values', () => {
  assert.equal(mergeSemanticWithPrevious(draft({ symbol: 'MGC', targetPrice: null }), prior(draft()), at).targetPrice, null);
  assert.equal(mergeSemanticWithPrevious(draft({ targetPrice: null }), prior(draft()), '2026-09-20T20:01:00Z').targetPrice, null);
});
test('repeated partial scans cannot refresh the age of retained facts', () => {
  const held = mergeSemanticWithPrevious(draft({ targetPrice: null }), prior(draft()), '2026-09-20T20:00:04Z');
  const next = mergeSemanticWithPrevious(draft({ targetPrice: null }), prior(held, '2026-09-20T20:00:04Z'), '2026-09-20T20:00:06Z');
  assert.equal(next.targetPrice, null);
});
test('a new draft cannot borrow old live-position details', () => {
  const old = prior(draft({ positionStatus: 'OPEN', intentState: 'POSITION_OPEN' }));
  assert.equal(mergeSemanticWithPrevious(draft({ targetPrice: null }), old, at).targetPrice, null);
});
test('split panes do not mix order identities', () => {
  const a = { source: 'semantic', frame: draft({ symbol: 'GC', quantity: 2, targetPrice: null }) };
  const b = { source: 'semantic', frame: draft({ symbol: 'MNQ', positionStatus: 'PENDING', intentState: 'ORDER_WORKING' }) };
  const merged = fuseExecutionReads(a, b).frame;
  assert.equal(merged.symbol, 'GC');
  assert.equal(merged.quantity, 2);
  assert.equal(merged.targetPrice, null);
});
test('accessibility orders respect the active OCR symbol', () => {
  const frame = inspectSemanticExecution('button | Change order quantity\nbutton | Buy 2 GCZ2026 @ 3,000 limit\nbutton | Buy 10 MNQZ2026 @ 29,733.75 limit', 'MNQ').frame;
  assert.equal(frame.symbol, 'MNQ');
  assert.equal(frame.quantity, 10);
});
test('visual clearing is not repopulated from stale semantic facts', () => {
  const flat = draft({ positionStatus: 'FLAT', intentState: 'NONE', symbol: null });
  assert.equal(mergeVisualWithSemantic(flat, draft()).intentState, 'NONE');
});
test('visual preparation works without a broker panel', () => {
  const frame = draft({ brokerPanelVisible: false });
  assert.equal(frame.intentState, 'PREPARING');
  assert.equal(isRichExecutionRead(frame), true);
});
test('short brackets use exact protective and target prices', () => {
  const frame = inspectSemanticExecution('button | Change order quantity\nbutton | Sell 5 MESZ2026 @ 6,000 limit\nbutton | Buy 5 MESZ2026 @ 6,010 stop\nbutton | Buy 5 MESZ2026 @ 5,980 limit').frame;
  assert.equal(frame.side, 'SHORT');
  assert.equal(frame.stopPrice, 6010);
  assert.equal(frame.targetPrice, 5980);
});
test('OCR noise is not accepted as a futures symbol', () => {
  assert.equal(draft({ symbol: 'MWAI' }).symbol, null);
  assert.equal(draft({ symbol: 'MGC1!' }).symbol, 'MGC');
});
test('live MYM position survives opposite-side exit accessibility labels', () => {
  const local = inspectLocalOcrExecution('JARVIS_OCR_EXECUTION|STATUS=OPEN|SYMBOL=MYM|SIDE=LONG|QTY=1|TYPE=|ENTRY=52244|CURRENT=52383|STOP=52303|TARGET=52571|PNL=69.5');
  const exits = inspectSemanticExecution('button | Sell 1 MYMZ2026 @ 52,303 stop\nbutton | Sell 1 MYMZ2026 @ 52,571 limit\nbutton | Cancel order');
  const frame = fuseExecutionReads(local, exits).frame;
  assert.equal(frame.positionStatus, 'OPEN');
  assert.equal(frame.side, 'LONG');
  assert.equal(frame.quantity, 1);
  assert.equal(frame.entryPrice, 52244);
  assert.equal(frame.currentPrice, 52383);
  assert.equal(frame.stopPrice, 52303);
  assert.equal(frame.targetPrice, 52571);
  assert.equal(frame.openPnl, 69.5);
  assert.equal(frame.orderType, null);
});
test('live trailing stops are valid on either side of entry', () => {
  for (const side of ['LONG', 'SHORT']) {
    const frame = draft({ side, positionStatus: 'OPEN', intentState: 'POSITION_OPEN', stopPrice: side === 'LONG' ? 29750 : 29700 });
    const result = fuseExecutionReads({source:'semantic', frame}, {source:'semantic', frame}).frame;
    assert.equal(result.stopPrice, frame.stopPrice);
  }
});

function rowsText(rows) { return rows.map(([text,x,y,w=70,h=12])=>`JARVIS_OCR|X=${x}|Y=${y}|W=${w}|H=${h}|TEXT=${text}`).join('\r\r\n'); }
const splitLiveRows = [
 ['MYM1!, 5',20,90], ['1',600,200,12], ['Sell Limit',620,200,65], ['52,571',900,200],
 ['1',600,400,12], ['Sell Stop',620,400,65], ['52,303',900,400],
 ['1',600,600,12], ['+102.50 USD',625,600,100], ['52,244',900,600],
 ['MYMZ2026',815,300,80], ['52,449',900,300],
];
test('real Windows split qty/order and qty/P&L labels establish a live position', () => {
 const frame=inspectOcrLayoutExecution(rowsText(splitLiveRows)).frame;
 assert.equal(frame.positionStatus,'OPEN'); assert.equal(frame.symbol,'MYM'); assert.equal(frame.side,'LONG');
 assert.equal(frame.quantity,1); assert.equal(frame.entryPrice,52244); assert.equal(frame.stopPrice,52303);
 assert.equal(frame.targetPrice,52571); assert.equal(frame.currentPrice,52449); assert.equal(frame.openPnl,102.5);
 assert.equal(isRichExecutionRead(frame),true);
});
test('Windows doubled carriage returns do not discard OCR geometry', () => {
 assert.equal(executionOcrDiagnostics(rowsText(splitLiveRows)).rowCount,splitLiveRows.length);
});
test('split exit labels without a live P&L row do not establish a position', () => {
 assert.equal(inspectOcrLayoutExecution(rowsText(splitLiveRows.filter(row=>!row[0].includes('USD')))),null);
});
test('a zero P&L remains a valid live position reading', () => {
 const frame=inspectOcrLayoutExecution(rowsText(splitLiveRows.map(row=>row[0].includes('USD')?['+0.00 USD',...row.slice(1)]:row))).frame;
 assert.equal(frame.positionStatus,'OPEN'); assert.equal(frame.openPnl,0);
});
test('fragmented draft quantity and order type populate before submission', () => {
 const frame=inspectOcrLayoutExecution(rowsText([
 ['MNQ1!, 5',20,90],['10',600,400,15],['Buy Limit',625,400,70],['29,733.75',900,400],
 ['10 - 500.00 USD',600,500,150],['29,708.75',900,500],['10 + 1000.00 USD',600,200,150],['29,783.75',900,200],
 ['MNQZ2026',800,300,80],['29,755.25',900,300],
 ])).frame;
 assert.equal(frame.intentState,'PREPARING'); assert.equal(frame.quantity,10); assert.equal(frame.orderType,'LIMIT');
 assert.equal(frame.entryPrice,29733.75); assert.equal(frame.stopPrice,29708.75); assert.equal(frame.targetPrice,29783.75);
 assert.equal(frame.currentPrice,29755.25); assert.equal(isRichExecutionRead(frame),true);
});

test('broker Positions count establishes OPEN even while price extraction is unavailable', () => {
 const frame=inspectSemanticExecution('tab item | Positions 1 | positions\nbutton | Long position').frame;
 assert.equal(frame.positionStatus,'OPEN'); assert.equal(frame.symbol,null); assert.equal(frame.side,null);
});
test('drawing toolbar position tools do not establish a broker position', () => {
 assert.equal(inspectSemanticExecution('button | Long position\ngroup | Short position'),null);
});
test('account position count does not relabel another pending draft as filled', () => {
 const count=inspectSemanticExecution('tab item | Positions 1 | positions');
 const result=fuseExecutionReads({source:'semantic',frame:draft()},count).frame;
 assert.equal(result.positionStatus,'OPEN'); assert.equal(result.entryPrice,null); assert.equal(result.symbol,null);
});
