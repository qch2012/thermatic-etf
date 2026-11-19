const test = require('node:test');
const assert = require('node:assert');
const { trendShade } = require('../site/trend.js');

test('trend shade: green for gains, red for losses, depth capped, blank when unknown', () => {
  assert.equal(trendShade(0.05, 0.1), 'rgba(26, 140, 60, 0.30)');
  assert.equal(trendShade(-0.5, 0.1), 'rgba(200, 40, 40, 0.60)');
  assert.equal(trendShade(null, 0.1), '');
});
