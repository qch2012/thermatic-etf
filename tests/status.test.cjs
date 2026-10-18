const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { describe, tradingDaysSince } = require('../site/status.js');

const data = (over = {}) => ({
  data_as_of: '2026-10-16', generated_at: '2026-10-16T22:48:31+00:00', funds: new Array(364).fill({}),
  failed_fetches: [], ...over,
});
const at = iso => new Date(iso + 'T12:00:00Z');

test('trading days count weekdays after the as-of date, through today', () => {
  // 2026-10-16 is a Friday.
  assert.equal(tradingDaysSince('2026-10-16', at('2026-10-16')), 0);
  assert.equal(tradingDaysSince('2026-10-16', at('2026-10-18')), 0); // Sunday
  assert.equal(tradingDaysSince('2026-10-16', at('2026-10-19')), 1);
  assert.equal(tradingDaysSince('2026-10-16', at('2026-10-20')), 2);
  assert.equal(tradingDaysSince('2026-10-16', at('2026-10-21')), 3);
});

test('status line shows as-of, last run, fund count and failed fetches', () => {
  const failed = [{ ticker: 'AAA', error: 'x' }, { ticker: 'BBB', error: 'y' }];
  const { line } = describe(data({ failed_fetches: failed }), at('2026-10-17'));
  assert.equal(line, 'Data as of 2026-10-16 · Last run 2026-10-16 22:48 UTC · 364 funds · 2 failed fetches (AAA, BBB)');
  assert.match(describe(data(), at('2026-10-17')).line, /0 failed fetches$/);
});

test('stale banner appears only after more than 2 trading days', () => {
  assert.equal(describe(data(), at('2026-10-20')).banner, null);
  assert.match(describe(data(), at('2026-10-21')).banner, /^Stale data: .*2026-10-16.*3 trading days/);
  assert.match(describe(data({ data_as_of: null }), at('2026-10-17')).banner, /^Stale data/);
});

test('mount point is filled from data/screen.json; banner is added when stale', async () => {
  class El { constructor(t) { this.tagName = t; this.children = []; this.attributes = {}; this.textContent = ''; }
    append(...c) { this.children.push(...c); } replaceChildren(...c) { this.children = c; } setAttribute(k, v) { this.attributes[k] = v; } }
  const mount = new El('div');
  const run = async json => {
    mount.children = [];
    const document = { querySelector: () => mount, createElement: t => new El(t) };
    const fetch = async () => (json ? { ok: true, json: async () => json } : { ok: false, status: 404 });
    vm.runInNewContext(fs.readFileSync('site/status.js', 'utf8'), { document, fetch, Date: class extends Date { constructor(...a) { super(...(a.length ? a : ['2026-10-21T12:00:00Z'])); } } });
    await new Promise(resolve => setImmediate(resolve));
    return mount.children.map(c => [c.tagName, c.attributes.role, c.textContent]);
  };
  const stale = await run(data());
  assert.equal(stale.length, 2);
  assert.deepEqual(stale[0].slice(0, 2), ['p', 'alert']);
  assert.match(stale[0][2], /^Stale data/);
  assert.match(stale[1][2], /^Data as of 2026-10-16/);
  assert.equal((await run(data({ data_as_of: '2026-10-20' }))).length, 1);
  const missing = await run(null);
  assert.match(missing[0][2], /^Stale data: cannot read/);
});
