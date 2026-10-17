const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
  children = [];
  textContent = '';
  checked = false;
  listeners = {};
  append(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
}

function page(fetch) {
  const elements = Object.fromEntries(['funds', 'all', 'status'].map(id => [`#${id}`, new Element()]));
  const document = { querySelector: id => elements[id], createElement: () => new Element() };
  vm.runInNewContext(fs.readFileSync('site/app.js', 'utf8'), { document, fetch, URL, Intl });
  return elements;
}

test('renders top three, all-screened toggle, issuer links and synthetic label', async () => {
  const funds = [1, 2, 3, 4, null].map((rank, i) => ({
    ticker: `F${i}`, rank, name: '<script>not HTML</script>', status: rank ? 'Eligible' : 'No price data', theme: 'Semiconductors',
    first_trade_date: '2022-01-03', assets_as_of: '2026-01-01', assets_source: 'stub',
    issuer_url: i === 0 ? 'https://issuer.example/fund' : null,
    net_assets: 100e6, expense_ratio: 0.005, cumulative_return: 0.2, ratio: 1, dollar_volume: 1e6, score: 90,
  }));
  const elements = page(async () => ({ ok: true, json: async () => ({
    funds: [...funds, { ...funds[4], ticker: 'C0', theme: 'Cannabis' }], synthetic: true,
    themes: [
      { theme: 'Semiconductors', group: 'Technology', eligible: 4, window: { start: '2024-01-02', end: '2026-01-01', observations: 500 } },
    ],
    no_eligible_themes: [{ theme: 'Cannabis', group: 'Social', candidates: [{ ticker: 'C0', name: 'Pot ETF', status: 'No price data' }] }],
    generated_at: '2026-01-01', failed_fetches: [],
  }) }));
  await new Promise(resolve => setImmediate(resolve));
  const rows = elements['#funds'].children;
  assert.equal(rows.length, 7);  // theme row + top three, section row, Cannabis row, its candidate
  assert.match(rows[0].children[0].textContent, /Technology — Semiconductors.*2024-01-02 to 2026-01-01/);
  assert.match(rows[4].children[0].textContent, /Themes with no eligible fund/);
  assert.match(rows[5].children[0].textContent, /Social — Cannabis/);
  assert.deepEqual(rows[6].children.map(c => c.textContent), ['C0', 'Pot ETF', 'No price data']);
  const cells = rows[1].children;
  assert.equal(cells[1].children[0].href, 'https://issuer.example/fund');
  assert.equal(cells[2].textContent, '<script>not HTML</script>');
  assert.equal(cells[9].textContent, '90.00');
  assert.match(elements['#status'].textContent, /SYNTHETIC DEMO/);
  elements['#all'].checked = true;
  elements['#all'].listeners.change();
  assert.equal(elements['#funds'].children.length, 9);
});

test('reports missing generated data', async () => {
  const elements = page(async () => ({ ok: false, status: 404 }));
  await new Promise(resolve => setImmediate(resolve));
  assert.match(elements['#status'].textContent, /Cannot load screen: HTTP 404/);
});
