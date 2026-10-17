const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

class Element {
  constructor(tagName) { this.tagName = tagName; }
  children = [];
  attributes = {};
  listeners = {};
  textContent = '';
  value = '';
  checked = false;
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
}

// Like the DOM getter: an element with children reads as their joined text.
const text = el => el.children.length ? el.children.map(text).join('') : String(el.textContent);

async function page(json) {
  const elements = {};
  const document = { querySelector: id => (elements[id] ??= new Element(id)), createElement: tag => new Element(tag) };
  const fetch = async () => (json ? { ok: true, json: async () => json } : { ok: false, status: 404 });
  vm.runInNewContext(fs.readFileSync('site/app.js', 'utf8'), { document, fetch, URL, Intl });
  await new Promise(resolve => setImmediate(resolve));
  const set = (id, prop, value) => { elements[id][prop] = value; elements[id].listeners.input(); };
  const headers = () => elements['#head'].children.map(text);
  const rows = () => elements['#funds'].children;
  const fundRows = () => rows().filter(r => r.children[0].tagName === 'td');
  const tickers = () => fundRows().map(r => text(r.children[1]));
  const headings = () => rows().filter(r => r.children[0].tagName === 'th').map(r => text(r.children[0]));
  return { elements, set, headers, rows, fundRows, tickers, headings };
}

const HEADERS = ['Rank', 'Ticker', 'Name', 'Launched', 'Net assets', 'Fee', 'Window', 'Return', 'Ratio',
  'Avg daily $ volume', 'Top 3 holdings', 'Score', 'Status / flags'];

function base(over) {
  return { group: 'Technology', theme: 'Semiconductors', first_trade_date: '2020-01-02', net_assets: 500e6,
    assets_source: 'Yahoo totalAssets', assets_as_of: '2026-10-17', assets_stale: false, stale: false, issuer_url: null,
    expense_ratio: 0.005, cumulative_return: 0.2, ratio: 0.5, dollar_volume: 2e6, age: 6, new: false,
    status: 'Eligible', score: 50, performance_unmeasured: false, ...over };
}

const FIXTURE = {
  data_source: 'stub', synthetic: true, generated_at: '2026-10-17T22:00:00+00:00', failed_fetches: [],
  themes: [
    { theme: 'Semiconductors', group: 'Technology', candidates: 5, eligible: 4, window: { start: '2023-10-16', end: '2026-10-16', observations: 754 } },
    { theme: 'Cannabis', group: 'Social', candidates: 1, eligible: 1, window: null },
  ],
  no_eligible_themes: [
    { theme: 'Hydrogen', group: 'Physical world', candidates: [{ ticker: 'H1', name: 'Hydrogen ETF', status: 'Under $100M (established minimum)' }] },
    { theme: 'Aging & longevity', group: 'Social', candidates: [] },
  ],
  funds: [
    base({ ticker: 'S1', name: 'Big Chip ETF', rank: 1, score: 91.234, net_assets: 1234567890, issuer_url: 'https://issuer.example/s1' }),
    base({ ticker: 'S2', name: '<b>New Chip</b>', rank: 2, net_assets: 40e6, assets_source: 'issuer website', assets_as_of: '2026-08-31',
      age: 0.3, new: true, performance_unmeasured: true, cumulative_return: null, ratio: null }),
    base({ ticker: 'S3', name: 'Stale Chip ETF', rank: 3, net_assets: 300e6, stale: true, assets_stale: true }),
    base({ ticker: 'S4', name: 'Fourth Chip ETF', rank: 4, net_assets: 200e6, expense_ratio: null }),
    // No price data: method.py gives new: true without an age (contract caveat).
    base({ ticker: 'S5', name: 'Dead Chip ETF', rank: null, score: null, status: 'No price data', new: true, age: undefined,
      net_assets: null, cumulative_return: null, ratio: null, dollar_volume: undefined, performance_unmeasured: undefined }),
    base({ ticker: 'C1', name: 'Pot ETF', theme: 'Cannabis', group: 'Social', rank: 1, score: 100, cumulative_return: null, ratio: null, performance_unmeasured: true }),
    base({ ticker: 'H1', name: 'Hydrogen ETF', theme: 'Hydrogen', group: 'Physical world', status: 'Under $100M (established minimum)',
      rank: null, score: null, net_assets: 60e6, issuer_url: 'https://issuer.example/h1' }),
  ],
};

const parseMoney = s => Number(s.replace(/[$,]/g, '').replace(/[KMBT]$/, '')) * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[s.at(-1)] ?? 1);

test('every number on the main screen matches a real pipeline run', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-'));
  fs.writeFileSync(path.join(dir, 'stub.yaml'), 'data_source: stub\n');
  execFileSync('python3', ['-m', 'pipeline', '--settings', path.join(dir, 'stub.yaml'),
    '--directory', 'tests/fixtures/nasdaqtraded_2026-10-17_seed_tickers.txt', '--output', path.join(dir, 'screen.json')]);
  const data = JSON.parse(fs.readFileSync(path.join(dir, 'screen.json'), 'utf8'));
  const p = await page(data);
  assert.deepEqual(p.headers(), HEADERS);
  // Default Top 3: at most three eligible funds per theme.
  assert.equal(p.fundRows().length, data.themes.reduce((n, t) => n + Math.min(3, t.eligible), 0));
  p.set('#mode', 'value', 'all');
  const rows = p.fundRows();
  assert.equal(rows.length, data.funds.length);
  const windows = Object.fromEntries(data.themes.map(t => [t.theme, t.window]));
  const byTicker = new Map(rows.map(r => [text(r.children[1]), r.children]));
  for (const f of data.funds) {
    const cells = byTicker.get(f.ticker);
    assert.equal(cells.length, HEADERS.length, f.ticker);
    const at = label => text(cells[HEADERS.indexOf(label)]);
    const close = (shown, value, tolerance) => value == null ? assert.ok(Number.isNaN(shown), f.ticker)
      : assert.ok(Math.abs(shown - value) <= tolerance, `${f.ticker}: ${shown} vs ${value}`);
    assert.equal(at('Rank'), f.rank == null ? '—' : String(f.rank));
    assert.equal(at('Name'), f.name);
    assert.equal(at('Launched'), f.first_trade_date);
    const [assets, asOf] = at('Net assets').split(' · ');
    close(parseMoney(assets.replace('*', '')), f.net_assets, f.net_assets * 0.005);
    assert.equal(assets.endsWith('*'), f.assets_source !== 'Yahoo totalAssets');
    assert.equal(asOf, f.assets_as_of);
    close(parseFloat(at('Fee')) / 100, f.expense_ratio, 0.00005 + 1e-12);
    const w = windows[f.theme];
    assert.equal(at('Window'), w && f.cumulative_return != null ? `${w.start} to ${w.end}` : '—');
    close(parseFloat(at('Return')) / 100, f.cumulative_return, 0.00005 + 1e-12);
    close(parseFloat(at('Ratio')), f.ratio, 0.005 + 1e-12);
    close(parseMoney(at('Avg daily $ volume')), f.dollar_volume, f.dollar_volume * 0.005);
    close(parseFloat(at('Score')), f.score, 0.05 + 1e-12);
    assert.equal(cells[1].children[0]?.href, f.issuer_url ?? undefined);
  }
});

test('columns, links and flags line up for every row, including themes with no eligible fund', async () => {
  const p = await page(FIXTURE);
  assert.deepEqual(p.tickers(), ['S1', 'S2', 'S3', 'C1', 'H1']);
  for (const row of p.fundRows()) assert.equal(row.children.length, HEADERS.length);
  const cells = Object.fromEntries(p.fundRows().map(r => [text(r.children[1]), r.children.map(text)]));
  assert.deepEqual(cells.S1.slice(0, 9), ['1', 'S1', 'Big Chip ETF', '2020-01-02', '$1.23B · 2026-10-17', '0.50%', '2023-10-16 to 2026-10-16', '20.00%', '0.50']);
  assert.equal(cells.S1[11], '91.2');
  assert.equal(cells.S2[2], '<b>New Chip</b>');  // text, not HTML
  assert.equal(cells.S2[4], '$40M* · 2026-08-31');
  assert.equal(cells.S2[6], '—');  // unmeasured: no window
  assert.match(cells.S2[12], /🆕/);
  assert.match(cells.S2[12], /†/);
  assert.match(cells.S3[12], /stale/);
  assert.equal(cells.H1[0], '—');
  assert.match(cells.H1[12], /Under \$100M/);
  const h1 = p.fundRows().find(r => text(r.children[1]) === 'H1');
  assert.equal(h1.children[1].children[0].href, 'https://issuer.example/h1');
  const headings = p.headings();
  assert.ok(headings.indexOf('Themes with no eligible fund') < headings.findIndex(h => h.startsWith('Physical world — Hydrogen')));
  assert.ok(headings.some(h => h.startsWith('Social — Aging & longevity') && /no candidates/.test(h)));
});

test('Top 3 / All eligible / All screened toggle', async () => {
  const p = await page(FIXTURE);
  p.set('#mode', 'value', 'eligible');
  assert.deepEqual(p.tickers(), ['S1', 'S2', 'S3', 'S4', 'C1', 'H1']);
  p.set('#mode', 'value', 'all');
  assert.deepEqual(p.tickers(), ['S1', 'S2', 'S3', 'S4', 'S5', 'C1', 'H1']);
  const s5 = p.fundRows().find(r => text(r.children[1]) === 'S5').children.map(text);
  assert.equal(s5[12], 'No price data');  // no 🆕: no price data means no known age
});

test('filters by group, theme, text, 🆕 only and hide under $50M', async () => {
  const p = await page(FIXTURE);
  p.set('#mode', 'value', 'all');
  p.set('#new-only', 'checked', true);
  assert.deepEqual(p.tickers(), ['S2']);  // S5 has new: true but no price data
  assert.ok(!p.headings().includes('Themes with no eligible fund'));  // empty section has no heading
  p.set('#new-only', 'checked', false);
  p.set('#hide-small', 'checked', true);
  assert.deepEqual(p.tickers(), ['S1', 'S3', 'S4', 'S5', 'C1', 'H1']);  // unknown size is not "under $50M"
  p.set('#hide-small', 'checked', false);
  p.set('#group', 'value', 'Social');
  assert.deepEqual(p.tickers(), ['C1']);
  assert.ok(p.headings().some(h => h.startsWith('Social — Aging & longevity')));
  assert.ok(!p.headings().some(h => h.includes('Hydrogen')));
  p.set('#group', 'value', '');
  p.set('#theme', 'value', 'Hydrogen');
  assert.deepEqual(p.tickers(), ['H1']);
  p.set('#theme', 'value', '');
  p.set('#search', 'value', 'POT');
  assert.deepEqual(p.tickers(), ['C1']);
  p.set('#search', 'value', 's4');
  assert.deepEqual(p.tickers(), ['S4']);
  assert.deepEqual(p.elements['#group'].children.map(o => o.value), ['', 'Technology', 'Social', 'Physical world']);
  assert.deepEqual(p.elements['#theme'].children.map(o => o.value), ['', 'Semiconductors', 'Cannabis', 'Hydrogen', 'Aging & longevity']);
});

test('sorting reorders funds inside each theme and keeps the grouping', async () => {
  const p = await page(FIXTURE);
  p.set('#mode', 'value', 'eligible');
  const button = label => p.elements['#head'].children[HEADERS.indexOf(label)].children[0];
  button('Net assets').listeners.click();
  assert.deepEqual(p.tickers(), ['S2', 'S4', 'S3', 'S1', 'C1', 'H1']);
  assert.equal(p.elements['#head'].children[HEADERS.indexOf('Net assets')].attributes['aria-sort'], 'ascending');
  button('Net assets').listeners.click();
  assert.deepEqual(p.tickers(), ['S1', 'S3', 'S4', 'S2', 'C1', 'H1']);
  button('Fee').listeners.click();  // S4 has no fee: missing values go last
  assert.deepEqual(p.tickers().slice(0, 4), ['S1', 'S2', 'S3', 'S4']);
});

test('page states scores are not comparable across themes, and labels synthetic data', async () => {
  assert.match(fs.readFileSync('site/index.html', 'utf8'), /not comparable across themes/);
  const p = await page(FIXTURE);
  assert.match(p.elements['#status'].textContent, /SYNTHETIC DEMO/);
});

test('reports missing generated data', async () => {
  const p = await page(null);
  assert.match(p.elements['#status'].textContent, /Cannot load screen: HTTP 404/);
});
