const { test } = require('node:test');
const assert = require('node:assert/strict');
const { overlap, daysApart, HIGH, MAX_GAP_DAYS } = require('../site/overlap.js');

// Holdings files as the pipeline writes them: `company` comes from pipeline/holdings match_companies
// (local listing in NATO and ADR in EUAD share one key); non-equity rows have company null.
const NATO = { ticker: 'NATO', as_of: '2026-10-19', holdings: [
  { name: 'AIRBUS GROUP SE', asset_type: 'Equity', weight: 0.0663, company: 'name:airbus group' },
  { name: 'BAE Systems PLC', asset_type: 'Equity', weight: 0.0415, company: 'name:bae systems' },
  { name: 'Astronics Corp', asset_type: 'Equity', weight: 0.0009, company: 'name:astronics' },
  { name: 'Astronics Corp', asset_type: 'Equity', weight: 0.0002, company: 'name:astronics' },
  { name: 'Boeing Co/The', asset_type: 'Equity', weight: 0.0728, company: 'name:boeing' },
  { name: 'EURO', asset_type: 'Cash', weight: 0.5, company: null },
] };
const EUAD = { ticker: 'EUAD', as_of: '2026-10-15', holdings: [
  { name: 'AIRBUS GROUP SE', asset_type: 'Equity', weight: 0.181428, company: 'name:airbus group' },
  { name: 'BAE SYSTEMS PLC -SPON ADR', asset_type: 'Equity', weight: 0.107434, company: 'name:bae systems' },
  { name: 'Astronics Corp', asset_type: 'Equity', weight: 0.01, company: 'name:astronics' },
  { name: 'Cash', asset_type: 'Cash', weight: 0.5, company: null },
] };

test('overlap sums the smaller weight of each shared company; NATO vs EUAD includes Airbus and BAE', () => {
  const result = overlap(NATO, EUAD);
  // 0.0663 (Airbus) + 0.0415 (BAE) + 0.0011 (Astronics, two NATO rows summed first); cash is not a company.
  assert.ok(Math.abs(result.value - 0.1089) < 1e-12);
  assert.deepEqual(result.shared.map(s => [s.name, s.a, s.b]), [
    ['AIRBUS GROUP SE', 0.0663, 0.181428], ['BAE Systems PLC', 0.0415, 0.107434], ['Astronics Corp', 0.0011, 0.01]]);
  assert.ok(Math.abs(overlap(EUAD, NATO).value - result.value) < 1e-12);
});

test('dates and highlight thresholds', () => {
  assert.equal(daysApart(NATO, EUAD), 4);
  assert.equal(daysApart({ as_of: '2026-10-01' }, { as_of: '2026-10-09' }), 8);
  assert.equal(HIGH, 0.3);
  assert.equal(MAX_GAP_DAYS, 7);
});
