const test = require('node:test');
const assert = require('node:assert');
const { filterStocks } = require('../site/stocks.js');

const fund = (ticker, theme, weight) => ({ ticker, theme, weight });
const STOCKS = [
  { name: 'Wide', direct: true, funds: [fund('A', 'T1', 0.02), fund('B', 'T2', 0.02), fund('C', 'T3', 0.02)] },
  { name: 'Narrow', direct: false, funds: [fund('A', 'T1', 0.05), fund('D', 'T3', 0.05)] },
];

test('stocks: ranked by themes, then funds; theme filter recounts and drops one-theme stocks; via-ETF filter', () => {
  assert.deepEqual(filterStocks(STOCKS, null, false).map(s => [s.name, s.themes.length]), [['Wide', 3], ['Narrow', 2]]);
  assert.deepEqual(filterStocks(STOCKS, new Set(['T1', 'T2']), false).map(s => [s.name, s.funds.length]), [['Wide', 2]]);
  assert.deepEqual(filterStocks(STOCKS, null, true).map(s => s.name), ['Narrow']);
});
