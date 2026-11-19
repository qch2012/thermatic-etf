// Stocks tab (SPEC 6.9). Reads data/stocks.json (built by the pipeline) and screen.json for each theme's momentum box.
// Display only, never scored. Uses themeTrend() and bucket() from trend.js, which loads first.
const STOCKS_SHOWN = 50;

// Keep only the funds in `themes` (null = all), drop stocks left with fewer than 2 themes, re-rank.
function filterStocks(stocks, themes, viaEtfOnly) {
  const rows = [];
  for (const stock of stocks) {
    if (viaEtfOnly && stock.direct) continue;
    const funds = themes ? stock.funds.filter(f => themes.has(f.theme)) : stock.funds;
    const inThemes = [...new Set(funds.map(f => f.theme))].sort();
    if (inThemes.length < 2) continue;
    const avg = funds.reduce((sum, f) => sum + f.weight, 0) / funds.length;
    rows.push({ ...stock, funds, themes: inThemes, avg_weight: avg });
  }
  return rows.sort((a, b) => b.themes.length - a.themes.length || b.funds.length - a.funds.length
    || b.avg_weight - a.avg_weight || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

if (typeof module !== 'undefined') module.exports = { filterStocks };

if (typeof document !== 'undefined' && document.getElementById('stocks')) {
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const pct = v => `${(v * 100).toFixed(1)}%`;
  const state = { all: false, buckets: {} };

  // Funds holding one stock, largest weight first; the top one is the most direct way to own it through an ETF.
  const renderDetail = stock => {
    const table = el('table', null, 'heatmap');
    table.append(el('caption', `${stock.name}: ${stock.listing}. Funds holding it at 1% or more, largest weight first; the top one is highlighted.`));
    const head = el('tr');
    ['Fund', 'Theme', 'Momentum', 'Weight'].forEach(t => head.append(el('th', t)));
    table.createTHead().append(head);
    const body = table.createTBody();
    stock.funds.forEach((f, i) => {
      const row = el('tr', null, i === 0 ? 'top' : '');
      row.append(el('td', f.ticker), el('td', f.theme), el('td', state.buckets[f.theme] ?? '—'), el('td', pct(f.weight), 'num'));
      body.append(row);
    });
    document.getElementById('stocks-detail').replaceChildren(table);
  };

  const render = () => {
    const choice = document.getElementById('stocks-bucket').value;
    const wanted = choice ? new Set(choice.split(',')) : null;
    const themes = wanted && new Set(Object.keys(state.buckets).filter(t => wanted.has(state.buckets[t])));
    const rows = filterStocks(state.data.stocks, themes, document.getElementById('stocks-via-etf').checked);
    const table = el('table');
    table.append(el('caption', `${rows.length} stocks held by funds in 2 or more ${wanted ? 'of the selected ' : ''}themes.`));
    const head = el('tr');
    [['#', 'num'], ['Stock'], ['Ticker'], ['Country'], ['Buy'], ['Themes', 'num'], ['Funds', 'num'], ['Avg weight', 'num'], ['Theme names']]
      .forEach(([t, cls]) => head.append(el('th', t, cls)));
    table.createTHead().append(head);
    const body = table.createTBody();
    rows.slice(0, state.all ? rows.length : STOCKS_SHOWN).forEach((stock, i) => {
      const row = el('tr');
      const name = el('button', stock.name, 'chart-link');
      name.type = 'button';
      name.addEventListener('click', () => renderDetail(stock));
      const nameCell = el('td', null, 'name');
      nameCell.append(name);
      const buy = Object.assign(el('td', stock.direct ? 'Direct' : 'Via ETF', stock.direct ? 'nowrap' : 'nowrap via-etf'), { title: stock.listing });
      const names = Object.assign(el('td', stock.themes.join(', '), 'holdings'), { title: stock.themes.join(', ') });
      row.append(el('td', i + 1, 'num'), nameCell, el('td', stock.ticker ?? '—', 'ticker'), el('td', stock.country ?? '—', 'nowrap'),
        buy, el('td', stock.themes.length, 'num'), el('td', stock.funds.length, 'num'), el('td', pct(stock.avg_weight), 'num'), names);
      body.append(row);
    });
    document.getElementById('stocks-body').replaceChildren(table);
    const more = document.getElementById('stocks-more');
    more.hidden = rows.length <= STOCKS_SHOWN;
    more.textContent = state.all ? `Show top ${STOCKS_SHOWN}` : `Show all ${rows.length}`;
  };

  Promise.all(['data/stocks.json', 'data/screen.json'].map(url => fetch(url).then(r => {
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  }))).then(([stocks, screen]) => {
    state.data = stocks;
    for (const theme of screen.themes.map(t => t.theme)) {
      state.buckets[theme] = bucket(themeTrend(screen.funds.filter(f => f.theme === theme && f.status === 'Eligible')));
    }
    const [from, to] = stocks.holdings_as_of;
    document.getElementById('stocks-asof').textContent = `Holdings as of ${from} to ${to}.`;
    document.getElementById('stocks-bucket').addEventListener('input', render);
    document.getElementById('stocks-via-etf').addEventListener('input', render);
    document.getElementById('stocks-more').addEventListener('click', () => { state.all = !state.all; render(); });
    render();
  }).catch(error => {
    document.getElementById('stocks-body').textContent = `Cannot load stocks: ${error.message}`;
  });
}
