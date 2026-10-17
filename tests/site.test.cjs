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
  const elements = Object.fromEntries(['funds', 'all', 'theme', 'status', 'window'].map(id => [`#${id}`, new Element()]));
  const document = { querySelector: id => elements[id], createElement: () => new Element() };
  vm.runInNewContext(fs.readFileSync('site/app.js', 'utf8'), { document, fetch, URL, Intl });
  return elements;
}

test('renders top three, all-screened toggle, issuer links and synthetic label', async () => {
  const funds = [1, 2, 3, 4, null].map((rank, i) => ({
    ticker: `F${i}`, rank, name: '<script>not HTML</script>', status: rank ? 'Eligible' : 'No price data',
    first_trade_date: '2022-01-03', assets_as_of: '2026-01-01', assets_source: 'stub',
    issuer_url: i === 0 ? 'https://issuer.example/fund' : null,
    net_assets: 100e6, expense_ratio: 0.005, cumulative_return: 0.2, ratio: 1, dollar_volume: 1e6, score: 90,
  }));
  const elements = page(async () => ({ ok: true, json: async () => ({
    funds, theme: 'Semiconductors', group: 'Technology', synthetic: true,
    generated_at: '2026-01-01', failed_fetches: [], window: null,
  }) }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements['#funds'].children.length, 3);
  const cells = elements['#funds'].children[0].children;
  assert.equal(cells[1].children[0].href, 'https://issuer.example/fund');
  assert.equal(cells[2].textContent, '<script>not HTML</script>');
  assert.equal(cells[9].textContent, '90.00');
  assert.match(elements['#status'].textContent, /SYNTHETIC DEMO/);
  elements['#all'].checked = true;
  elements['#all'].listeners.change();
  assert.equal(elements['#funds'].children.length, 5);
});

test('reports missing generated data', async () => {
  const elements = page(async () => ({ ok: false, status: 404 }));
  await new Promise(resolve => setImmediate(resolve));
  assert.match(elements['#status'].textContent, /Cannot load screen: HTTP 404/);
});
