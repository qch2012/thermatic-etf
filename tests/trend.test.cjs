const test = require('node:test');
const assert = require('node:assert');
const { trendShade, themeTrend, bucket, rebaseYear, chartStart } = require('../site/trend.js');

test('trend shade: green for gains, red for losses, depth capped, blank when unknown', () => {
  assert.equal(trendShade(0.05, 0.1), 'rgba(26, 140, 60, 0.30)');
  assert.equal(trendShade(-0.5, 0.1), 'rgba(200, 40, 40, 0.60)');
  assert.equal(trendShade(null, 0.1), '');
});

test('theme trend is the median of funds per period, skipping missing values', () => {
  const t = themeTrend([{ trend: { '1m': 0.1, '3m': null } }, { trend: { '1m': 0.3, '3m': 0.2 } }, { trend: { '1m': -0.5, '3m': 0.4 } }]);
  assert.equal(t['1m'], 0.1);
  assert.ok(Math.abs(t['3m'] - 0.3) < 1e-12);
  assert.equal(t['1y'], null);
});

test('bucket by 1M vs 3M sign; zero counts as up; null when too new', () => {
  assert.equal(bucket({ '1m': 0.02, '3m': 0.1 }), 'Rising');
  assert.equal(bucket({ '1m': 0.02, '3m': -0.1 }), 'Recovering');
  assert.equal(bucket({ '1m': -0.02, '3m': 0 }), 'Fading');
  assert.equal(bucket({ '1m': -0.02, '3m': -0.1 }), 'Falling');
  assert.equal(bucket({ '1m': 0.02, '3m': null }), null);
});

test('rebaseYear: starts at the last close on or before one year back, null when younger', () => {
  const dates = ['2025-01-02', '2025-11-18', '2025-11-20', '2026-06-01', '2026-11-19'];
  const line = rebaseYear(dates, [10, 50, 60, 70, 100], '2026-11-19');  // one year back = 2025-11-19
  assert.deepEqual(line, { dates: dates.slice(1), values: [100, 120, 140, 200] });
  assert.equal(rebaseYear(dates.slice(2), [60, 70, 100], '2026-11-19'), null);
});

test('chartStart: one year back, or the first date all funds share when one is younger', () => {
  assert.equal(chartStart(['2020-01-02', '2024-05-01'], '2026-11-19'), '2025-11-19');
  assert.equal(chartStart(['2020-01-02', '2026-03-10', '2026-01-05'], '2026-11-19'), '2026-03-10');
  const dates = ['2025-01-02', '2026-03-09', '2026-03-11', '2026-11-19'];
  assert.deepEqual(rebaseYear(dates, [10, 50, 60, 100], '2026-11-19', '2026-03-10'), { dates: dates.slice(1), values: [100, 120, 200] });
});
