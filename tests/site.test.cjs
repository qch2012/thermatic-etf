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
  innerHTML = '';
  hidden = true;
  focus() { this.focused = true; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
}

// Like the DOM getter: an element with children reads as their joined text.
const text = el => el.children.length ? el.children.map(text).join('') : String(el.textContent);

async function page(json, files = {}) {
  const elements = { '#mode': Object.assign(new Element('select'), {
    children: ['Top 3 per theme', 'All eligible', 'All screened (with gate status)'].map(t => Object.assign(new Element('option'), { textContent: t })) }) };
  const document = { querySelector: id => (elements[id] ??= new Element(id)), createElement: tag => new Element(tag) };
  const fetched = [], historyFetched = [];  // history files are counted apart so price-loading tests stay exact
  const fetch = async url => {
    (url.includes('/history/') ? historyFetched : fetched).push(url);
    const body = url === 'data/screen.json' ? json : files[url];
    return body ? { ok: true, json: async () => body } : { ok: false, status: 404 };
  };
  vm.runInNewContext(fs.readFileSync('site/app.js', 'utf8'), { document, fetch, URL, Intl });
  await new Promise(resolve => setImmediate(resolve));
  const set = (id, prop, value) => { elements[id][prop] = value; elements[id].listeners.input(); };
  const headers = () => elements['#head'].children.map(text);
  const rows = () => elements['#funds'].children;
  const fundRows = () => rows().filter(r => r.children[0].tagName === 'td');
  const tickers = () => fundRows().map(r => text(r.children[1]));
  const headings = () => rows().filter(r => r.children[0].tagName === 'th').map(r => text(r.children[0]));
  return { elements, fetched, historyFetched, set, headers, rows, fundRows, tickers, headings };
}

const HEADERS = ['Rank', 'Ticker', 'Name', 'Launched', 'Net assets', 'Fee', 'Window', 'Return', 'Ratio',
  'Avg daily $ volume', 'Top 3 holdings', 'Score', 'Rank vs 1 week', 'Rank vs 1 month', 'Status / flags'];

function base(over) {
  return { group: 'Technology', theme: 'Semiconductors', first_trade_date: '2020-01-02', net_assets: 500e6,
    assets_source: 'Yahoo totalAssets', assets_as_of: '2026-10-17', assets_stale: false, stale: false, issuer_url: null,
    expense_ratio: 0.005, cumulative_return: 0.2, ratio: 0.5, dollar_volume: 2e6, age: 6, new: false,
    status: 'Eligible', score: 50, performance_unmeasured: false, ...over };
}

const FIXTURE = {
  data_source: 'stub', synthetic: true, generated_at: '2026-10-17T22:00:00+00:00', failed_fetches: [],
  weights: { size: 0.4, cost: 0.2, performance: 0.4 },
  themes: [
    { theme: 'Semiconductors', group: 'Technology', candidates: 5, eligible: 4, window: { start: '2023-10-16', end: '2026-10-16', observations: 754 } },
    { theme: 'Cannabis', group: 'Social', candidates: 1, eligible: 1, window: null },
  ],
  no_eligible_themes: [
    { theme: 'Hydrogen', group: 'Physical world', candidates: [{ ticker: 'H1', name: 'Hydrogen ETF', status: 'Under $100M (established minimum)' }] },
    { theme: 'Aging & longevity', group: 'Social', candidates: [] },
  ],
  funds: [
    base({ ticker: 'S1', name: 'Big Chip ETF', rank: 1, score: 91.234, percentiles: { size: 1, cost: 1, performance: 0.78085 }, net_assets: 1234567890, issuer_url: 'https://issuer.example/s1' }),
    base({ ticker: 'S2', name: '<b>New Chip</b>', rank: 2, score: 50, percentiles: { size: 0.25, cost: 1, performance: 0.5 }, net_assets: 40e6, assets_source: 'issuer website', assets_as_of: '2026-08-31',
      age: 0.3, new: true, performance_unmeasured: true, cumulative_return: null, ratio: null }),
    base({ ticker: 'S3', name: 'Stale Chip ETF', rank: 3, score: 44, percentiles: { size: 0.75, cost: 0.5, performance: 0.1 }, net_assets: 300e6, stale: true, assets_stale: true }),
    base({ ticker: 'S4', name: 'Fourth Chip ETF', rank: 4, score: 34, percentiles: { size: 0.5, cost: 0.5, performance: 0.1 }, net_assets: 200e6, expense_ratio: null }),
    // No price data: method.py gives new: true without an age (contract caveat).
    base({ ticker: 'S5', name: 'Dead Chip ETF', rank: null, score: null, status: 'No price data', new: true, age: undefined,
      first_trade_date: null, fetched_at: null,
      net_assets: null, cumulative_return: null, ratio: null, dollar_volume: undefined, performance_unmeasured: undefined }),
    base({ ticker: 'C1', name: 'Pot ETF', theme: 'Cannabis', group: 'Social', rank: 1, score: 80, percentiles: { size: 1, cost: 1, performance: 0.5 }, cumulative_return: null, ratio: null, performance_unmeasured: true }),
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
  // Default weights: live ranks are the pipeline's ranks, in the pipeline's order (ties included).
  for (const t of data.themes) {
    const expected = data.funds.filter(f => f.theme === t.theme && f.rank != null).sort((a, b) => a.rank - b.rank).map(f => f.ticker);
    assert.deepEqual(p.tickers().filter(k => expected.includes(k)), expected, t.theme);
  }
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
    assert.equal(at('Launched'), f.first_trade_date ?? '—');
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
  assert.deepEqual(p.tickers(), ['S1', 'S2', 'S3', 'C1']);
  p.set('#mode', 'value', 'eligible');
  assert.deepEqual(p.tickers(), ['S1', 'S2', 'S3', 'S4', 'C1', 'H1']);
  for (const row of p.fundRows()) assert.equal(row.children.length, HEADERS.length);
  const cells = Object.fromEntries(p.fundRows().map(r => [text(r.children[1]), r.children.map(text)]));
  assert.deepEqual(cells.S1.slice(0, 9), ['1', 'S1', 'Big Chip ETF', '2020-01-02', '$1.23B · 2026-10-17', '0.50%', '2023-10-16 to 2026-10-16', '20.00%', '0.50']);
  assert.equal(cells.S1[11], '91.2');
  assert.equal(cells.S2[2], '<b>New Chip</b>');  // text, not HTML
  assert.equal(cells.S2[4], '$40M* · 2026-08-31');
  assert.equal(cells.S2[6], '—');  // unmeasured: no window
  assert.match(cells.S2[HEADERS.indexOf('Status / flags')], /🆕/);
  assert.match(cells.S2[HEADERS.indexOf('Status / flags')], /†/);
  assert.match(cells.S3[HEADERS.indexOf('Status / flags')], /stale/);
  assert.equal(cells.H1[0], '—');
  assert.match(cells.H1[HEADERS.indexOf('Status / flags')], /Under \$100M/);
  const h1 = p.fundRows().find(r => text(r.children[1]) === 'H1');
  assert.equal(h1.children[1].children[0].href, 'https://issuer.example/h1');
  const headings = p.headings();
  assert.ok(headings.indexOf('Themes with no eligible fund') < headings.findIndex(h => h.startsWith('Physical world — Hydrogen')));
  assert.ok(headings.some(h => h.startsWith('Social — Aging & longevity') && /no candidates/.test(h)));
});

test('Top 3 view lists themes with no eligible fund by name only, with a count', async () => {
  const p = await page(FIXTURE);
  assert.deepEqual(p.tickers(), ['S1', 'S2', 'S3', 'C1']);  // no H1 candidate row
  const headings = () => p.headings().filter(h => /Hydrogen|Aging|no eligible/.test(h));
  assert.deepEqual(headings(), ['Themes with no eligible fund (2)', 'Physical world — Hydrogen', 'Social — Aging & longevity']);
  p.set('#group', 'value', 'Social');
  assert.deepEqual(headings(), ['Themes with no eligible fund (1)', 'Social — Aging & longevity']);
  p.set('#group', 'value', '');
  p.set('#search', 'value', 'hydrogen');  // a fund filter keeps only themes with a matching candidate
  assert.deepEqual(headings(), ['Themes with no eligible fund (1)', 'Physical world — Hydrogen']);
  p.set('#search', 'value', '');
  p.set('#mode', 'value', 'all');  // the other views keep the full candidate rows
  assert.ok(p.tickers().includes('H1'));
  assert.ok(p.headings().includes('Themes with no eligible fund'));
});

test('Top 3 / All eligible / All screened toggle', async () => {
  const p = await page(FIXTURE);
  p.set('#mode', 'value', 'eligible');
  assert.deepEqual(p.tickers(), ['S1', 'S2', 'S3', 'S4', 'C1', 'H1']);
  p.set('#mode', 'value', 'all');
  assert.deepEqual(p.tickers(), ['S1', 'S2', 'S3', 'S4', 'S5', 'C1', 'H1']);
  const s5 = p.fundRows().find(r => text(r.children[1]) === 'S5').children.map(text);
  assert.equal(s5[3], '—');  // first_trade_date: null shows a dash, not "null"
  assert.equal(s5[HEADERS.indexOf('Status / flags')], 'No price data');  // no 🆕: no price data means no known age
});

test('filters by group, theme, text, 🆕 only and hide under $50M', async () => {
  const p = await page(FIXTURE);
  p.set('#mode', 'value', 'all');
  p.set('#new-only', 'checked', true);
  assert.deepEqual(p.tickers(), ['S2']);  // S5 has new: true but no price data
  assert.ok(!p.headings().includes('Themes with no eligible fund'));  // empty section has no heading
  p.set('#new-only', 'checked', false);
  p.set('#hide-small', 'checked', true);
  assert.deepEqual(p.tickers(), ['S1', 'S3', 'S4', 'C1', 'H1']);  // unknown size is hidden too (Andy, 2026-10-17)
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

test('bad issuer URL falls back to a plain ticker', async () => {
  const data = structuredClone(FIXTURE);
  data.funds[0].issuer_url = 'not a url';
  const p = await page(data);
  const s1 = p.fundRows()[0].children[1];
  assert.equal(s1.children.length, 0);
  assert.equal(text(s1), 'S1');
});

test('theme dropdown narrows to the chosen group', async () => {
  const p = await page(FIXTURE);
  p.set('#theme', 'value', 'Semiconductors');
  p.set('#group', 'value', 'Social');
  assert.deepEqual(p.elements['#theme'].children.map(o => o.value), ['', 'Cannabis', 'Aging & longevity']);
  assert.equal(p.elements['#theme'].value, '');  // a theme outside the group is cleared
  assert.deepEqual(p.tickers(), ['C1']);
  p.set('#group', 'value', '');
  assert.equal(p.elements['#theme'].children.length, 5);
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

const SLIDERS = { size: '#w-size', cost: '#w-cost', performance: '#w-performance' };
const weights = (p, size, cost, performance) => { p.set(SLIDERS.size, 'value', size); p.set(SLIDERS.cost, 'value', cost); p.set(SLIDERS.performance, 'value', performance); };
const column = (p, label) => p.fundRows().map(r => text(r.children[HEADERS.indexOf(label)]));

test('live weights start at the pipeline defaults and show normalized percentages', async () => {
  const p = await page(FIXTURE);
  assert.deepEqual(Object.values(SLIDERS).map(id => Number(p.elements[id].value)), [40, 20, 40]);
  assert.deepEqual(Object.keys(SLIDERS).map(k => p.elements[`#w-${k}-out`].textContent), ['40%', '20%', '40%']);
  assert.equal(Number(p.elements['#top-n'].value), 3);
  p.set('#mode', 'value', 'eligible');
  assert.deepEqual(column(p, 'Score').slice(0, 4), ['91.2', '50.0', '44.0', '34.0']);
  // Weights are normalized: 50/25/50 is the same split as 40/20/40, so nothing moves.
  weights(p, '50', '25', '50');
  assert.deepEqual(Object.keys(SLIDERS).map(k => p.elements[`#w-${k}-out`].textContent), ['40%', '20%', '40%']);
  assert.deepEqual(p.tickers(), ['S1', 'S2', 'S3', 'S4', 'C1', 'H1']);
  assert.deepEqual(column(p, 'Score').slice(0, 4), ['91.2', '50.0', '44.0', '34.0']);
});

test('moving a slider reorders funds, ranks and scores live; Reset restores the defaults', async () => {
  const p = await page(FIXTURE);
  p.set('#mode', 'value', 'eligible');
  weights(p, '100', '0', '0');  // size only: S1 100, S3 75, S4 50, S2 25
  assert.deepEqual(p.tickers(), ['S1', 'S3', 'S4', 'S2', 'C1', 'H1']);
  assert.deepEqual(column(p, 'Rank').slice(0, 5), ['1', '2', '3', '4', '1']);
  assert.deepEqual(column(p, 'Score').slice(0, 5), ['100.0', '75.0', '50.0', '25.0', '100.0']);
  assert.deepEqual(Object.keys(SLIDERS).map(k => p.elements[`#w-${k}-out`].textContent), ['100%', '0%', '0%']);
  assert.match(p.elements['#weights-state'].textContent, /custom/i);
  p.set('#mode', 'value', 'top3');  // Top 3 follows the live rank, not the pipeline rank
  assert.deepEqual(p.tickers(), ['S1', 'S3', 'S4', 'C1']);
  p.elements['#weights-reset'].listeners.click();
  assert.deepEqual(Object.values(SLIDERS).map(id => Number(p.elements[id].value)), [40, 20, 40]);
  assert.deepEqual(p.tickers(), ['S1', 'S2', 'S3', 'C1']);
  assert.deepEqual(column(p, 'Rank'), ['1', '2', '3', '1']);
  assert.doesNotMatch(p.elements['#weights-state'].textContent, /custom/i);
});

test('sorting by Rank follows the live rank', async () => {
  const p = await page(FIXTURE);
  p.set('#mode', 'value', 'eligible');
  weights(p, '100', '0', '0');
  p.elements['#head'].children[0].children[0].listeners.click();  // Rank ascending
  assert.deepEqual(p.tickers().slice(0, 4), ['S1', 'S3', 'S4', 'S2']);
  p.elements['#head'].children[0].children[0].listeners.click();  // Rank descending
  assert.deepEqual(p.tickers().slice(0, 4), ['S2', 'S4', 'S3', 'S1']);
});

test('equal scores rank by net assets, then by ticker', async () => {
  const tie = (ticker, net_assets, rank) => base({ ticker, name: ticker, rank, net_assets, percentiles: { size: 0.5, cost: 0.5, performance: 0.5 } });
  const data = { ...FIXTURE, no_eligible_themes: [], themes: [FIXTURE.themes[0]],
    funds: [tie('CCC', 400e6, 1), tie('AAA', 300e6, 2), tie('BBB', 300e6, 3), tie('DDD', 100e6, 4)] };
  const p = await page(data);
  p.set('#mode', 'value', 'eligible');
  assert.deepEqual(p.tickers(), ['CCC', 'AAA', 'BBB', 'DDD']);
  assert.deepEqual(column(p, 'Rank'), ['1', '2', '3', '4']);
  weights(p, '10', '90', '0');  // still all tied
  assert.deepEqual(p.tickers(), ['CCC', 'AAA', 'BBB', 'DDD']);
});

test('top-N slider sets how many funds Top view shows; Reset returns to 3', async () => {
  const p = await page(FIXTURE);
  p.set('#top-n', 'value', '2');
  assert.deepEqual(p.tickers(), ['S1', 'S2', 'C1']);
  assert.equal(p.elements['#mode'].children[0].textContent, 'Top 2 per theme');
  p.set('#top-n', 'value', '4');
  assert.deepEqual(p.tickers(), ['S1', 'S2', 'S3', 'S4', 'C1']);
  p.elements['#weights-reset'].listeners.click();
  assert.equal(Number(p.elements['#top-n'].value), 3);
  assert.equal(p.elements['#mode'].children[0].textContent, 'Top 3 per theme');
  assert.deepEqual(p.tickers(), ['S1', 'S2', 'S3', 'C1']);
});

test('all weights at zero fall back to the defaults', async () => {
  const p = await page(FIXTURE);
  weights(p, '0', '0', '0');
  assert.deepEqual(p.tickers(), ['S1', 'S2', 'S3', 'C1']);
  assert.deepEqual(Object.keys(SLIDERS).map(k => p.elements[`#w-${k}-out`].textContent), ['40%', '20%', '40%']);
});

test('page says gates and windows stay as computed next to the sliders', () => {
  const html = fs.readFileSync('site/index.html', 'utf8');
  assert.match(html, /<section id="weights"[\s\S]*id="w-size"[\s\S]*gates and performance windows stay as the pipeline computed them[\s\S]*<\/section>/i);
});

const prices = (ticker, dates, adjusted_close) => [`data/prices/${ticker}.json`, { ticker, dates, adjusted_close }];
const PRICES = Object.fromEntries([
  prices('S1', ['2023-10-13', '2023-10-16', '2024-10-16', '2026-10-16'], [40, 50, 55, 65.6]),
  prices('S2', ['2026-06-01', '2026-10-16'], [10, 12]),
  prices('S3', ['2023-10-13', '2023-10-16', '2026-10-16'], [30, 25, 20]),
  // S4 is measured but has no price file: the chart must say so and still draw the others.
]);
const settle = () => new Promise(resolve => setTimeout(resolve, 5));
const nameButton = (p, ticker) => p.fundRows().find(r => text(r.children[1]) === ticker).children[2].children[0];
const themeButton = (p, name) => p.rows().find(r => r.children[0].tagName === 'th' && text(r.children[0]).includes(`— ${name}`)).children[0].children[0].children[0];

test('prices are loaded lazily, once per ticker, when a fund is clicked', async () => {
  const p = await page(FIXTURE, PRICES);
  assert.deepEqual(p.fetched, ['data/screen.json']);  // nothing price-related at load
  assert.match(fs.readFileSync('site/index.html', 'utf8'), /<section id="chart-panel" hidden/);  // closed until a fund is clicked
  nameButton(p, 'S1').listeners.click();
  await settle();
  assert.deepEqual(p.fetched, ['data/screen.json', 'data/prices/S1.json']);
  assert.equal(p.elements['#chart-panel'].hidden, false);
  assert.match(p.elements['#chart-title'].textContent, /S1.*Big Chip ETF/);
  assert.match(p.elements['#chart-body'].innerHTML, /<svg[^>]*role="img"/);
  assert.match(p.elements['#chart-summary'].textContent, /40\.00 on 2023-10-13.*65\.60 on 2026-10-16/);
  nameButton(p, 'S1').listeners.click();  // same trigger again closes
  assert.equal(p.elements['#chart-panel'].hidden, true);
  nameButton(p, 'S1').listeners.click();
  await settle();
  assert.equal(p.fetched.filter(u => u.includes('S1')).length, 1);  // cached
  assert.equal(p.elements['#chart-panel'].hidden, false);
});

test('fund chart text is escaped, Close hides the panel, a missing file is reported', async () => {
  const p = await page(FIXTURE, PRICES);
  p.set('#mode', 'value', 'all');
  nameButton(p, 'S2').listeners.click();
  await settle();
  assert.doesNotMatch(p.elements['#chart-body'].innerHTML, /<b>New/);
  p.elements['#chart-close'].listeners.click();
  assert.equal(p.elements['#chart-panel'].hidden, true);
  nameButton(p, 'S4').listeners.click();
  await settle();
  assert.match(p.elements['#chart-summary'].textContent, /Cannot load prices for S4/);
  assert.equal(p.elements['#chart-body'].innerHTML, '');
  nameButton(p, 'S5').listeners.click();  // no price data: no request at all
  await settle();
  assert.ok(!p.fetched.some(u => u.includes('S5')));
  assert.match(p.elements['#chart-summary'].textContent, /No price data for S5/);
});

test('theme chart rebases measured peers to 100 at the window start and shades the window', async () => {
  const p = await page(FIXTURE, PRICES);
  assert.ok(!p.rows().some(r => text(r.children[0]).includes('Cannabis') && r.children[0].children[0]?.children[0]?.tagName === 'button'));  // no window: no chart
  themeButton(p, 'Semiconductors').listeners.click();
  await settle();
  assert.deepEqual(p.fetched.slice(1).sort(), ['data/prices/S1.json', 'data/prices/S3.json', 'data/prices/S4.json']);  // measured only (not S2)
  assert.equal(p.elements['#chart-panel'].hidden, false);
  assert.match(p.elements['#chart-title'].textContent, /Semiconductors/);
  const html = p.elements['#chart-body'].innerHTML;
  assert.match(html, /<rect class="window" data-start="2023-10-16" data-end="2026-10-16"/);
  assert.match(html, /data-ticker="S1"/);
  assert.match(html, /data-ticker="S3"/);
  const summary = p.elements['#chart-summary'].textContent;
  assert.match(summary, /S1 131\.2/);  // 65.6 / 50 * 100
  assert.match(summary, /S3 80\.0/);   // 20 / 25 * 100
  assert.match(summary, /S4: no price file/);
});

test('closing a chart returns focus to its trigger even after the table re-rendered', async () => {
  const p = await page(FIXTURE, PRICES);
  const old = nameButton(p, 'S1');
  old.listeners.click();
  await settle();
  weights(p, '100', '0', '0');  // re-render: the table now holds a new S1 button
  const fresh = nameButton(p, 'S1');
  assert.notEqual(fresh, old);
  p.elements['#chart-close'].listeners.click();
  assert.equal(p.elements['#chart-panel'].hidden, true);
  assert.ok(fresh.focused, 'focus goes to the S1 button now in the table');
  assert.ok(!old.focused, 'not to the detached one');
  // Trigger no longer in the table (filtered out): focus falls back to the table region.
  fresh.listeners.click();
  await settle();
  p.set('#search', 'value', 's4');
  p.elements['#chart-close'].listeners.click();
  assert.ok(p.elements['.table-scroll'].focused);

});
const html = fs.readFileSync('site/index.html', 'utf8');
const method = html.match(/<section id="method"[\s\S]*?<\/section>/)?.[0] ?? '';
const strip = h => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('Method panel: linked from the top, and every rule has its why right after it', () => {
  assert.match(html, /<nav[^>]*>[\s\S]*<a href="#method">/);
  const items = [...method.matchAll(/<li>\s*<p class="rule">([\s\S]*?)<\/p>\s*<p class="why">([\s\S]*?)<\/p>\s*<\/li>/g)];
  assert.ok(items.length >= 18, `only ${items.length} rule/why pairs`);
  assert.equal(items.length, (method.match(/<p class="rule">/g) ?? []).length);  // no rule without a why
  assert.equal(items.length, (method.match(/<p class="why">/g) ?? []).length);
  for (const [, rule, why] of items) {
    assert.ok(strip(rule).trim().length > 20, strip(rule));
    assert.match(strip(why), /^\s*Why: \S/, strip(rule));
    assert.ok(strip(why).length > 40, `thin reason for: ${strip(rule)}`);
  }
});

test('Method panel states the SPEC section 5 numbers and gate status texts', () => {
  const spec = fs.readFileSync('SPEC.md', 'utf8').split('## 5. Screening method')[1].split('## 6.')[0].replace(/\\/g, '');
  const words = strip(method);
  // Literals from SPEC 5.2 to 5.6, typed here rather than parsed, so a wording change in the panel is caught.
  for (const needle of ['$100M', '$25M', '$0.5M', '63 trading days', '3 years', '0.5 years', '365.25', '252', '40%', '20%',
    'No price data', 'No net-asset data', 'Under $100M (established minimum)', 'Under $25M (emerging minimum)', 'Under $0.5M avg daily $ volume', 'Top 3']) {
    assert.ok(spec.includes(needle), `SPEC section 5 has no "${needle}" (fix the test)`);
    assert.ok(words.includes(needle), `Method panel is missing "${needle}"`);
  }
  assert.match(words, /sliders/i);
});

test('page is noindex and loads nothing from outside: no CDN, external font or tracker', () => {
  assert.match(html, /<meta name="robots" content="[^"]*noindex/);
  for (const file of ['site/index.html', 'site/style.css', 'site/app.js']) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /(https?:)?\/\/[a-z0-9-]+\.[a-z]/i, file);  // any absolute or protocol-relative URL
  }
  assert.match(html, /<meta name="viewport" content="width=device-width/);
});

test('every form control has a text label', () => {
  const controls = [...html.matchAll(/<(?:input|select)\b[^>]*\bid="([^"]+)"/g)].map(m => m[1]);
  assert.ok(controls.length >= 10);
  for (const id of controls) {
    const labelled = html.includes(`for="${id}"`) || [...html.matchAll(/<label\b(?![^>]*\bfor=)[^>]*>[\s\S]*?<\/label>/g)].some(m => m[0].includes(`id="${id}"`));
    assert.ok(labelled, `#${id} has no <label>`);
  }
});

test('Method panel: the Gates list holds exactly the four gates; age is explained outside it', () => {
  const part = h3 => method.split(/<h3>/).find(chunk => chunk.startsWith(h3)) ?? '';
  const gates = part('Gates');
  assert.equal((gates.match(/<li>/g) ?? []).length, 4);
  assert.doesNotMatch(strip(gates), /365\.25/);
  assert.match(strip(method), /Age is the days between the first trade date/);
});

// Ranking history (SPEC 6.4). Today = the run date, 2026-10-17. Snapshots hold pipeline (default-weight) ranks.
const snap = (date, ranks) => [`data/history/${date}.json`, { date, funds: Object.fromEntries(Object.entries(ranks).map(([t, r]) =>
  [t, [t === 'C1' ? 'Cannabis' : 'Semiconductors', r, r == null ? null : 50, 1e8]])) }];
const history = (...snaps) => ({ 'data/history/index.json': snaps.map(s => s[1].date), ...Object.fromEntries(snaps) });
const HISTORY = history(
  snap('2026-09-10', { S1: 5, S2: 1, S3: 2, S4: 3, C1: 1 }),
  snap('2026-10-09', { S1: 3, S2: 2, S3: 1, S4: 4, C1: 1 }));

test('rank change vs 1 week and 1 month uses the nearest snapshot on or before today-7 / today-30', async () => {
  const p = await page(FIXTURE, HISTORY);
  p.set('#mode', 'value', 'eligible');
  const week = ticker => text(p.fundRows().find(r => text(r.children[1]) === ticker).children[HEADERS.indexOf('Rank vs 1 week')]);
  const month = ticker => text(p.fundRows().find(r => text(r.children[1]) === ticker).children[HEADERS.indexOf('Rank vs 1 month')]);
  assert.deepEqual(['S1', 'S2', 'S3', 'S4', 'C1'].map(week), ['▲2', '=', '▼2', '=', '=']);  // 2026-10-09
  assert.deepEqual(['S1', 'S2', 'S3', 'S4', 'C1'].map(month), ['▲4', '▼1', '▼1', '▼1', '=']);  // 2026-09-10
  const cell = p.fundRows()[0].children[HEADERS.indexOf('Rank vs 1 week')];
  assert.match(cell.title ?? '', /2026-10-09.*daily-run weights/);
  // Only the two snapshots the table needs were fetched, plus the index.
  assert.deepEqual(p.historyFetched.sort(), ['data/history/2026-09-10.json', 'data/history/2026-10-09.json', 'data/history/index.json']);
});

test('rank change uses pipeline ranks, not live-weight ranks', async () => {
  const p = await page(FIXTURE, HISTORY);
  p.set('#mode', 'value', 'eligible');
  weights(p, '0', '100', '0');  // live ranks change; the change columns must not
  const col = label => p.fundRows().map(r => [text(r.children[1]), text(r.children[HEADERS.indexOf(label)])]);
  assert.deepEqual(col('Rank vs 1 week').filter(([t]) => t === 'S1' || t === 'S3'), [['S1', '▲2'], ['S3', '▼2']]);
});

test('no history, no matching snapshot or no rank gives an em dash and the page still works', async () => {
  const none = await page(FIXTURE);
  none.set('#mode', 'value', 'eligible');
  assert.ok(none.fundRows().every(r => text(r.children[HEADERS.indexOf('Rank vs 1 week')]) === '—'));
  // Only a 5-day-old snapshot: too recent for 1 week and 1 month.
  const recent = await page(FIXTURE, history(snap('2026-10-12', { S1: 2 })));
  recent.set('#mode', 'value', 'eligible');
  assert.ok(recent.fundRows().every(r => text(r.children[HEADERS.indexOf('Rank vs 1 week')]) === '—'));
  // A fund not ranked then (rank null) has no change.
  const unranked = await page(FIXTURE, history(snap('2026-10-09', { S1: null, S2: 2 })));
  unranked.set('#mode', 'value', 'eligible');
  const week = ticker => text(unranked.fundRows().find(r => text(r.children[1]) === ticker).children[HEADERS.indexOf('Rank vs 1 week')]);
  assert.deepEqual([week('S1'), week('S2')], ['—', '=']);
});

test('top 3 entries and exits in the last 30 days, per theme', async () => {
  const p = await page(FIXTURE, HISTORY);
  await settle();
  const html = p.elements['#moves-body'].innerHTML;
  assert.match(html, /Since 2026-09-10/);
  assert.match(html, /Semiconductors[\s\S]*entered[\s\S]*S1[\s\S]*left[\s\S]*S4/);
  assert.doesNotMatch(html, /Cannabis/);  // no move there
});

test('top 3 moves fall back to the oldest snapshot and say how far back it goes', async () => {
  const p = await page(FIXTURE, history(snap('2026-10-12', { S1: 4, S2: 2, S3: 1, S4: 3, C1: 1 })));
  await settle();
  const html = p.elements['#moves-body'].innerHTML;
  assert.match(html, /Since 2026-10-12/);
  assert.match(html, /entered[\s\S]*S1/);
  assert.match(p.elements['#moves-body'].innerHTML, /only 5 days of history/);
  const empty = await page(FIXTURE);
  await settle();
  assert.match(empty.elements['#moves-body'].innerHTML, /No ranking history yet/);
});

test('rank over time: the fund chart adds a rank line from every snapshot plus today', async () => {
  const p = await page(FIXTURE, { ...PRICES, ...HISTORY });
  nameButton(p, 'S1').listeners.click();
  await settle();
  const html = p.elements['#chart-body'].innerHTML;
  assert.match(html, /<svg class="chart rank"[^>]*aria-label="S1 rank[^"]*5 on 2026-09-10[^"]*1 on 2026-10-17/);
  assert.match(html, /<polyline data-ticker="S1"/);
  assert.match(html, /daily-run weights/);
  // A fund with no price data still gets its rank line.
  const q = await page(FIXTURE, { ...PRICES, ...HISTORY });
  q.set('#mode', 'value', 'eligible');
  nameButton(q, 'S4').listeners.click();
  await settle();
  assert.match(q.elements['#chart-body'].innerHTML, /<svg class="chart rank"/);
});

test('rank over time with fewer than 2 points shows a sentence, not a line', async () => {
  const p = await page(FIXTURE, PRICES);
  nameButton(p, 'S1').listeners.click();
  await settle();
  assert.doesNotMatch(p.elements['#chart-body'].innerHTML, /class="chart rank"/);
  assert.match(p.elements['#chart-summary'].textContent, /Not enough ranking history/);
});

test('index.html mounts the moves panel and explains the history rules', () => {
  const doc = fs.readFileSync('site/index.html', 'utf8');
  assert.match(doc, /id="moves-body"/);
  assert.match(strip(doc), /nearest snapshot on or before/);
});

// Review fixes: theme changes, gaps in the rank line, one bad snapshot, table before history.
const raw = (date, funds) => [`data/history/${date}.json`, { date, funds }];
const cellOf = (p, ticker, label) => p.fundRows().find(r => text(r.children[1]) === ticker).children[HEADERS.indexOf(label)];

test('a fund that changed theme has no rank change across the change, and its rank line starts after it', async () => {
  const p = await page(FIXTURE, { ...PRICES, ...history(
    raw('2026-09-10', { S1: ['Cannabis', 1, 50, 1e8] }),
    raw('2026-10-09', { S1: ['Semiconductors', 3, 50, 1e8] })) });
  p.set('#mode', 'value', 'eligible');
  assert.equal(text(cellOf(p, 'S1', 'Rank vs 1 month')), '—');
  assert.match(cellOf(p, 'S1', 'Rank vs 1 month').title, /in another theme then/);
  assert.equal(text(cellOf(p, 'S1', 'Rank vs 1 week')), '▲2');
  nameButton(p, 'S1').listeners.click();
  await settle();
  const html = p.elements['#chart-body'].innerHTML.split('chart-sub')[1];  // the rank part, after the price chart
  assert.match(p.elements['#chart-summary'].textContent, /3 on 2026-10-09 to 1 on 2026-10-17/);
  assert.doesNotMatch(p.elements['#chart-summary'].textContent, /2026-09-10/);
  assert.equal((html.match(/<polyline data-ticker="S1"/g) ?? []).length, 1);
});

test('the rank line breaks across unranked days instead of connecting over them', async () => {
  const s = (date, rank) => raw(date, { S1: ['Semiconductors', rank, 50, 1e8] });
  const p = await page(FIXTURE, { ...PRICES, ...history(s('2026-09-10', 5), s('2026-09-24', 4), s('2026-10-02', null), s('2026-10-09', 3)) });
  nameButton(p, 'S1').listeners.click();
  await settle();
  assert.equal((p.elements['#chart-body'].innerHTML.split('chart-sub')[1].match(/<polyline data-ticker="S1"/g) ?? []).length, 2);
});

test('one missing snapshot does not disable the rest of the history', async () => {
  const files = { ...PRICES, ...history(snap('2026-09-10', { S1: 5, S2: 1, S3: 2, S4: 3, C1: 1 }), snap('2026-09-24', { S1: 4 })) };
  files['data/history/index.json'] = ['2026-09-10', '2026-09-24', '2026-10-09'];  // 2026-10-09 is listed but 404s
  const p = await page(FIXTURE, files);
  p.set('#mode', 'value', 'eligible');
  assert.equal(text(cellOf(p, 'S1', 'Rank vs 1 month')), '▲4');
  assert.equal(text(cellOf(p, 'S1', 'Rank vs 1 week')), '—');  // its snapshot is the broken one
  assert.match(p.elements['#moves-body'].innerHTML, /Since 2026-09-10/);
  nameButton(p, 'S1').listeners.click();
  await settle();
  assert.match(p.elements['#chart-summary'].textContent, /5 on 2026-09-10 to 1 on 2026-10-17/);
});

test('the table renders before history has loaded', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const p = await page(FIXTURE, { 'data/history/index.json': gate.then(() => []) });
  assert.deepEqual(p.tickers(), ['S1', 'S2', 'S3', 'C1']);
  release();
});
