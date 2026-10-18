// Main screen (SPEC 5.6, 6.1). One table grouped by group → theme. Later panels (live weights, charts,
// method) can change `view` or fund fields and call render(); the table code doesn't need to change.
const $ = selector => document.querySelector(selector);
const money = value => value == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumSignificantDigits: 3 }).format(value);
const number = (value, digits = 2) => value == null ? '—' : value.toFixed(digits);
const percent = value => value == null ? '—' : `${(value * 100).toFixed(2)}%`;

// method.py sets new: true when a fund has no price data (no age); only a known age under 0.5 years is 🆕.
const isNew = fund => fund.new && fund.age != null;
const windowOf = fund => fund.cumulative_return == null ? null : view.windows[fund.theme];

// weights are slider values (any scale, normalized below); live maps ticker → {rank, score} for the current weights.
const view = { data: null, windows: {}, mode: 'top3', group: '', theme: '', search: '', newOnly: false, hideSmall: false, sort: null,
  weights: null, topN: 3, live: new Map(), history: {} };
const WEIGHTS = ['size', 'cost', 'performance'];
const DEFAULT_TOP_N = 3;

const rankOf = fund => view.live.get(fund.ticker)?.rank ?? fund.rank;
const scoreOf = fund => view.live.get(fund.ticker)?.score ?? fund.score;

// SPEC 6.2 / contract "Score and rank". Same formula, operand order and tie-break as pipeline/method.py, so the
// default weights give the pipeline's scores and ranks exactly. All-zero sliders mean no usable split: use the defaults.
function normalizedWeights() {
  const total = WEIGHTS.reduce((sum, key) => sum + view.weights[key], 0);
  const raw = total > 0 ? view.weights : defaultSliders();
  const sum = WEIGHTS.reduce((n, key) => n + raw[key], 0);
  return Object.fromEntries(WEIGHTS.map(key => [key, raw[key] / sum]));
}

function rescore() {
  const w = normalizedWeights();
  const byTheme = new Map();
  for (const f of view.data.funds) {
    if (f.status !== 'Eligible') continue;
    const p = f.percentiles;
    const list = byTheme.get(f.theme) ?? byTheme.set(f.theme, []).get(f.theme);
    list.push({ fund: f, score: 100 * (w.size * p.size + w.cost * p.cost + w.performance * p.performance) });
  }
  view.live = new Map();
  for (const list of byTheme.values()) {
    list.sort((a, b) => b.score - a.score || b.fund.net_assets - a.fund.net_assets || (a.fund.ticker < b.fund.ticker ? -1 : a.fund.ticker > b.fund.ticker ? 1 : 0));
    list.forEach(({ fund, score }, i) => view.live.set(fund.ticker, { rank: i + 1, score }));
  }
}

const COLUMNS = [
  { label: 'Rank', value: rankOf, cell: f => rankOf(f) ?? '—' },
  { label: 'Ticker', value: f => f.ticker, cell: tickerCell },
  { label: 'Name', value: f => f.name, cell: f => chartButton(f.name, fundChart(f)) },
  { label: 'Launched', value: f => f.first_trade_date, cell: f => f.first_trade_date ?? '—' },
  { label: 'Net assets', value: f => f.net_assets, cell: f => `${money(f.net_assets)}${f.assets_source !== 'Yahoo totalAssets' ? '*' : ''} · ${f.assets_as_of}`, title: f => `Source: ${f.assets_source}` },
  { label: 'Fee', value: f => f.expense_ratio, cell: f => percent(f.expense_ratio) },
  { label: 'Window', value: f => windowOf(f)?.start, cell: f => windowOf(f) ? `${windowOf(f).start} to ${windowOf(f).end}` : '—' },
  { label: 'Return', value: f => f.cumulative_return, cell: f => percent(f.cumulative_return) },
  { label: 'Ratio', value: f => f.ratio, cell: f => number(f.ratio) },
  { label: 'Avg daily $ volume', value: f => f.dollar_volume, cell: f => money(f.dollar_volume) },
  { label: 'Top 3 holdings', value: null, cell: f => f.top_holdings?.map(h => `${h.name} ${percent(h.weight)}`).join(', ') || '—' },
  { label: 'Score', value: scoreOf, cell: f => number(scoreOf(f), 1) },
  ...[['Rank vs 1 week', 'week', 7], ['Rank vs 1 month', 'month', 30]].map(([label, key, days]) => ({
    label, value: f => rankChange(f, view.history[key]), cell: f => changeText(rankChange(f, view.history[key])),
    title: f => rankChangeTitle(f, view.history[key], days) })),
  { label: 'Status / flags', value: f => f.status, cell: flags },
];

function tickerCell(fund) {
  // Issuer page from config/issuer_links.json (via the pipeline); plain ticker when missing.
  let url;
  try { url = new URL(fund.issuer_url); } catch { return fund.ticker; }
  if (url.protocol !== 'https:') return fund.ticker;
  const link = document.createElement('a');
  link.href = url.href;
  link.textContent = fund.ticker;
  return link;
}

function flags(fund) {
  return [fund.status, isNew(fund) ? '🆕' : '', fund.performance_unmeasured ? '†' : '',
    fund.stale ? 'stale market data' : '', fund.assets_stale ? 'stale assets' : ''].filter(Boolean).join(' · ');
}

function visible(fund, mode) {
  const search = view.search.trim().toLowerCase();
  return (!view.group || fund.group === view.group) && (!view.theme || fund.theme === view.theme)
    && (!search || fund.ticker.toLowerCase().includes(search) || fund.name.toLowerCase().includes(search))
    && (!view.newOnly || isNew(fund)) && !(view.hideSmall && !(fund.net_assets >= 50e6))
    && (mode === 'all' || (fund.status === 'Eligible' && (mode === 'eligible' || rankOf(fund) <= view.topN)));
}

function sorted(funds) {
  // Missing values go last in both directions; ties keep pipeline order. Without a chosen sort: live rank.
  const { value } = COLUMNS[view.sort ? view.sort.column : 0];
  const sign = view.sort?.descending ? -1 : 1;
  return [...funds].sort((a, b) => {
    const x = value(a), y = value(b);
    if (x == null || y == null) return (x == null) - (y == null);
    return sign * (x < y ? -1 : x > y ? 1 : 0);
  });
}

function headingRow(body, text, className, chart) {
  const row = document.createElement('tr');
  const cell = document.createElement('th');
  cell.colSpan = COLUMNS.length;
  cell.scope = 'colgroup';
  cell.className = className;
  // The inner span stays in view when a wide table is scrolled sideways (CSS .stick).
  const inner = document.createElement('span');
  inner.className = 'stick';
  if (chart) inner.append(chartButton(text, chart));
  else inner.textContent = text;
  cell.append(inner);
  row.append(cell);
  body.append(row);
}

function fundRow(body, fund) {
  const row = document.createElement('tr');
  for (const column of COLUMNS) {
    const cell = document.createElement('td');
    const content = column.cell(fund);
    if (typeof content === 'object') cell.append(content);
    else cell.textContent = content;
    if (column.title) cell.title = column.title(fund);
    row.append(cell);
  }
  body.append(row);
}

function renderHead() {
  const row = $('#head');
  row.replaceChildren();
  COLUMNS.forEach((column, i) => {
    const th = document.createElement('th');
    th.scope = 'col';
    if (!column.value) th.textContent = column.label;
    else {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = column.label;
      button.addEventListener('click', () => {
        view.sort = { column: i, descending: view.sort?.column === i && !view.sort.descending };
        renderHead();
        render();
      });
      th.append(button);
      if (view.sort?.column === i) th.setAttribute('aria-sort', view.sort.descending ? 'descending' : 'ascending');
    }
    row.append(th);
  });
}

function render() {
  const body = $('#funds');
  body.replaceChildren();
  chartButtons.clear();
  const funds = view.data.funds;
  let group = null;
  for (const theme of view.data.themes) {
    const members = sorted(funds.filter(f => f.theme === theme.theme && visible(f, view.mode)));
    if (!members.length) continue;
    if (theme.group !== group) headingRow(body, group = theme.group, 'group');
    const window = theme.window ? `shared performance window ${theme.window.start} to ${theme.window.end} (${theme.window.observations} aligned observations)` : 'performance unmeasured';
    headingRow(body, `${theme.group} — ${theme.theme}: ${window}; ${theme.eligible} eligible of ${theme.candidates}`, 'theme', theme.window && themeChart(theme));
    members.forEach(f => fundRow(body, f));
  }
  // SPEC 5.6: listed separately with every candidate and its failed gate. Top view lists theme names only (Andy, 2026-10-17).
  const fundFilter = view.search.trim() || view.newOnly || view.hideSmall;
  const listed = [];
  for (const theme of view.data.no_eligible_themes) {
    if ((view.group && theme.group !== view.group) || (view.theme && theme.theme !== view.theme)) continue;
    const members = sorted(funds.filter(f => f.theme === theme.theme && visible(f, 'all')));
    if (!members.length && (theme.candidates.length || fundFilter)) continue;
    listed.push({ theme, members });
  }
  if (!listed.length) return;
  const namesOnly = view.mode === 'top3';
  headingRow(body, namesOnly ? `Themes with no eligible fund (${listed.length})` : 'Themes with no eligible fund', 'group');
  for (const { theme, members } of listed) {
    if (namesOnly) headingRow(body, `${theme.group} — ${theme.theme}`, 'theme');
    else {
      headingRow(body, `${theme.group} — ${theme.theme}${theme.candidates.length ? ': status shows why each candidate failed' : ': no candidates'}`, 'theme');
      members.forEach(f => fundRow(body, f));
    }
  }
}

// Price charts (SPEC 6.3). Hand-written inline SVG, no library. A chart is {key, title, build}: build() returns
// {svg, legend, summary} after loading price files lazily (data/prices/<TICKER>.json, one fetch per ticker).
const SERIES_COLORS = ['#00599b', '#c2570c', '#6a3d9a'];  // top 3 peers by live rank; validated categorical set
const OTHER_COLOR = '#7d8a96';
const prices = new Map();
let openChart = null;
const chartButtons = new Map();  // chart key → its button in the current table render

function loadPrices(ticker) {
  if (!prices.has(ticker)) {
    const request = fetch(`data/prices/${encodeURIComponent(ticker)}.json`).then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
    request.catch(() => prices.delete(ticker));  // a failed load can be retried
    prices.set(ticker, request);
  }
  return prices.get(ticker);
}

const esc = value => String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function fundChart(fund) {
  const priceChart = fundPriceChart(fund);
  return { key: priceChart.key, title: `${fund.ticker} ${fund.name}: adjusted close and rank over time`, build: async () => {
    const price = await priceChart.build(), rank = await rankChart(fund);
    return { svg: (price.svg ?? '') + (rank.svg ?? ''), summary: [price.summary, rank.summary].join(' ') };
  } };
}

function fundPriceChart(fund) {
  return { key: `fund:${fund.ticker}`, build: async () => {
    if (fund.age == null) return { summary: `No price data for ${fund.ticker}.` };  // no price file exists
    let file;
    try { file = await loadPrices(fund.ticker); } catch { return { summary: `Cannot load prices for ${fund.ticker}.` }; }
    const { dates, adjusted_close: close } = file, last = dates.length - 1;
    const summary = `${fund.ticker} adjusted close: ${close[0].toFixed(2)} on ${dates[0]} to ${close[last].toFixed(2)} on ${dates[last]} (${percent(close[last] / close[0] - 1)}). Adjusted close includes distributions.`;
    return { svg: chartSvg([{ ticker: fund.ticker, dates, values: close, color: SERIES_COLORS[0] }], null, null, summary), summary };
  } };
}

function themeChart(theme) {
  const { start, end } = theme.window;
  return { key: `theme:${theme.theme}`, title: `${theme.theme}: measured funds rebased to 100 on ${start}`, build: async () => {
    const peers = view.data.funds.filter(f => f.theme === theme.theme && f.cumulative_return != null)
      .sort((a, b) => rankOf(a) - rankOf(b));
    const loaded = await Promise.allSettled(peers.map(f => loadPrices(f.ticker)));
    const series = [], notes = [];
    peers.forEach((fund, i) => {
      if (loaded[i].status !== 'fulfilled') return notes.push(`${fund.ticker}: no price file`);
      const { dates, adjusted_close: close } = loaded[i].value;
      const base = close[dates.indexOf(start)];
      if (!(base > 0)) return notes.push(`${fund.ticker}: no price on ${start}`);
      series.push({ ticker: fund.ticker, dates, values: close.map(v => v / base * 100), color: SERIES_COLORS[series.length] ?? OTHER_COLOR });
    });
    const atEnd = series.map(s => `${s.ticker} ${s.values[s.dates.indexOf(end)]?.toFixed(1) ?? '—'}`);
    const summary = `Rebased to 100 on ${start}. On ${end}: ${atEnd.join(', ') || 'no funds drawn'}.${notes.length ? ` ${notes.join('; ')}.` : ''}`;
    const named = series.filter(s => s.color !== OTHER_COLOR);
    const others = series.length - named.length;
    const legend = named.map(s => `<li><i style="background:${s.color}"></i>${esc(s.ticker)}</li>`).join('')
      + (others ? `<li><i style="background:${OTHER_COLOR}"></i>${others} other measured fund${others > 1 ? 's' : ''}</li>` : '');
    return { svg: series.length ? chartSvg(series, { start, end }, 100, summary) : '', legend, summary };
  } };
}

// Round tick values: step is 1, 2 or 5 times a power of ten, at most `count` steps across the range.
function niceTicks(lo, hi, count = 4) {
  const raw = (hi - lo) / count, power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(m => m * power).find(candidate => candidate >= raw);
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  return ticks;
}

const DAY = 864e5;

function chartSvg(series, shade, baseline, label, rank = false) {
  const W = 720, H = 300, left = 48, right = 56, top = 12, bottom = 26;
  const days = series.flatMap(s => s.dates.map(d => Date.parse(d) / DAY));
  const all = series.flatMap(s => s.values).concat(baseline ?? []);
  const x0 = days.reduce((a, b) => Math.min(a, b)), x1 = days.reduce((a, b) => Math.max(a, b));
  let lo = all.reduce((a, b) => Math.min(a, b)), hi = all.reduce((a, b) => Math.max(a, b));
  const pad = (hi - lo || hi || 1) * 0.05;
  lo -= pad; hi += pad;
  const x = d => left + (d - x0) / ((x1 - x0) || 1) * (W - left - right);
  const y = v => top + (rank ? v - lo : hi - v) / (hi - lo) * (H - top - bottom);  // rank 1 (best) at the top
  const out = [`<svg class="chart${rank ? ' rank' : ''}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">`];
  if (shade) {
    const a = x(Date.parse(shade.start) / DAY), b = x(Date.parse(shade.end) / DAY);
    out.push(`<rect class="window" data-start="${shade.start}" data-end="${shade.end}" x="${a}" y="${top}" width="${b - a}" height="${H - top - bottom}"/>`);
  }
  for (const v of niceTicks(lo, hi).filter(v => !rank || Number.isInteger(v))) {
    out.push(`<line class="grid" x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}"/><text x="${left - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`);
  }
  // x ticks: January of each year over long spans, otherwise a few month starts
  const months = [];
  for (const d = new Date(x0 * DAY); ; ) {
    d.setUTCMonth(d.getUTCMonth() + 1, 1);
    if (d.getTime() / DAY > x1) break;
    months.push(new Date(d));
  }
  const long = x1 - x0 > 400, every = Math.ceil(months.length / 5);
  months.filter((d, i) => long ? d.getUTCMonth() === 0 : i % every === 0).forEach(d => {
    const text = long ? d.getUTCFullYear() : d.toISOString().slice(0, 7);
    out.push(`<text x="${x(d.getTime() / DAY)}" y="${H - 8}" text-anchor="middle">${text}</text>`);
  });
  if (baseline != null) out.push(`<line class="base" x1="${left}" x2="${W - right}" y1="${y(baseline)}" y2="${y(baseline)}"/>`);
  for (const s of series) {
    const points = s.values.map((v, i) => `${x(Date.parse(s.dates[i]) / DAY).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    out.push(`<polyline data-ticker="${esc(s.ticker)}" points="${points}" fill="none" stroke="${s.color}" stroke-width="${s.color === OTHER_COLOR ? 1 : 2}"/>`);
  }
  // direct labels on the colored lines, nudged apart so they don't overlap
  let lastY = -Infinity;
  series.filter(s => s.color !== OTHER_COLOR).map(s => ({ s, y: y(s.values.at(-1)) }))
    .sort((a, b) => a.y - b.y).forEach(item => {
      lastY = Math.max(item.y, lastY + 13);
      out.push(`<text x="${x(Date.parse(item.s.dates.at(-1)) / DAY) + 5}" y="${lastY + 4}" fill="${item.s.color}">${esc(item.s.ticker)}</text>`);
    });
  out.push('</svg>');
  return out.join('');
}

function chartButton(label, chart) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chart-link';
  button.textContent = label;
  button.title = 'Show price chart';
  chartButtons.set(chart.key, button);
  button.addEventListener('click', () => showChart(chart));
  return button;
}

function closeChart() {
  $('#chart-panel').hidden = true;
  // render() replaces the buttons, so look the trigger up by key; fall back to the table if it is no longer shown.
  (chartButtons.get(openChart?.key) ?? $('.table-scroll')).focus?.();
  openChart = null;
}

async function showChart(chart) {
  if (openChart?.key === chart.key) return closeChart();  // same trigger again closes
  openChart = { key: chart.key };
  $('#chart-panel').hidden = false;
  $('#chart-title').textContent = chart.title;
  $('#chart-body').innerHTML = '';
  $('#chart-summary').textContent = 'Loading prices…';
  $('#chart-close').focus?.();
  const result = await chart.build();
  if (openChart?.key !== chart.key) return;  // closed, or another chart was opened meanwhile
  $('#chart-body').innerHTML = `${result.svg ?? ''}${result.legend ? `<ul class="legend">${result.legend}</ul>` : ''}`;
  $('#chart-summary').textContent = result.summary;
}

function options(select, values) {
  select.replaceChildren();
  for (const value of ['', ...new Set(values)]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value || 'All';
    select.append(option);
  }
}

function renderControls() {
  const themes = [...view.data.themes, ...view.data.no_eligible_themes];
  const themeOptions = () => {
    const names = themes.filter(t => !view.group || t.group === view.group).map(t => t.theme);
    if (!names.includes(view.theme)) view.theme = '';
    options($('#theme'), names);
    $('#theme').value = view.theme;
  };
  options($('#group'), themes.map(t => t.group));
  themeOptions();
  const bind = (id, key, prop) => $(id).addEventListener('input', () => { view[key] = $(id)[prop]; if (key === 'group') themeOptions(); render(); });
  bind('#mode', 'mode', 'value');
  bind('#group', 'group', 'value');
  bind('#theme', 'theme', 'value');
  bind('#search', 'search', 'value');
  bind('#new-only', 'newOnly', 'checked');
  bind('#hide-small', 'hideSmall', 'checked');
  $('#chart-close').addEventListener('click', closeChart);
}

// Live weights (SPEC 6.2). Sliders hold raw values; the outputs show the normalized split.
const defaultSliders = () => Object.fromEntries(WEIGHTS.map(key => [key, Math.round(view.data.weights[key] * 1000) / 10]));
const isDefaultSplit = () => { const w = normalizedWeights(); return WEIGHTS.every(key => Math.abs(w[key] - view.data.weights[key]) < 1e-9); };

function syncWeights() {
  const w = normalizedWeights();
  for (const key of WEIGHTS) {
    $(`#w-${key}`).value = view.weights[key];
    $(`#w-${key}-out`).textContent = `${Number((w[key] * 100).toFixed(1))}%`;
  }
  $('#top-n').value = view.topN;
  $('#top-n-out').textContent = view.topN;
  $('#mode').children[0].textContent = `Top ${view.topN} per theme`;
  $('#weights-state').textContent = isDefaultSplit() ? 'Default weights: ranks match the daily run.' : 'Custom weights: ranks and scores differ from the daily run.';
}

function renderWeights() {
  view.weights = defaultSliders();
  for (const key of WEIGHTS) $(`#w-${key}`).addEventListener('input', () => { view.weights[key] = Number($(`#w-${key}`).value); update(); });
  $('#top-n').addEventListener('input', () => { view.topN = Number($('#top-n').value); update(); });
  $('#weights-reset').addEventListener('click', () => { view.weights = defaultSliders(); view.topN = DEFAULT_TOP_N; update(); });
  update();
}

function update() {
  rescore();
  syncWeights();
  render();
}

// Ranking history (SPEC 6.4, contract "History snapshots"). Snapshots hold pipeline (default-weight) ranks, so rank
// change and the rank line ignore the live sliders. "1 week" / "1 month" = nearest snapshot on or before today-7 / today-30,
// where today is the run date of screen.json.
const snapshots = new Map();

function loadSnapshot(date) {
  if (!snapshots.has(date)) {
    const request = fetch(`data/history/${date}.json`).then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
    request.catch(() => snapshots.delete(date));
    snapshots.set(date, request);
  }
  return snapshots.get(date).then(snapshot => snapshot.funds);
}

const daysBefore = (day, n) => new Date(Date.parse(day) - n * DAY).toISOString().slice(0, 10);
const snapshotOnOrBefore = (dates, day, n) => dates.filter(d => d <= daysBefore(day, n)).at(-1) ?? null;

async function loadHistory(today) {
  const history = { today, dates: [], week: null, month: null, base: null };
  view.history = history;
  try {
    const response = await fetch('data/history/index.json');
    if (!response.ok) return;
    history.dates = (await response.json()).filter(d => d < today);  // today's own snapshot is screen.json
    const pick = async date => date && { date, funds: await loadSnapshot(date) };
    history.week = await pick(snapshotOnOrBefore(history.dates, today, 7));
    history.month = await pick(snapshotOnOrBefore(history.dates, today, 30));
    history.base = history.month ?? await pick(history.dates[0]);  // too little history: oldest snapshot
  } catch { Object.assign(history, { dates: [], week: null, month: null, base: null }); }
}

function rankChange(fund, snapshot) {
  const was = snapshot?.funds[fund.ticker]?.[1];
  return was == null || fund.rank == null ? null : was - fund.rank;
}
const changeText = change => change == null ? '—' : change > 0 ? `▲${change}` : change < 0 ? `▼${-change}` : '=';

function rankChangeTitle(fund, snapshot, days) {
  if (!snapshot) return `No snapshot on or before ${days} days ago yet.`;
  const was = snapshot.funds[fund.ticker]?.[1];
  return `${was == null ? 'Unranked' : `Rank ${was}`} on ${snapshot.date} (nearest snapshot on or before ${days} days ago). Compares daily-run weights, not the live sliders. ▲ = moved up.`;
}

// Funds in a theme's top 3 now but not in the snapshot's (entered), and the reverse (left). Top 3 is fixed (SPEC 6.4).
function top3Moves(funds, snapshot) {
  const now = {}, was = {};
  for (const f of funds) if (f.rank != null && f.rank <= 3) (now[f.theme] ??= new Set()).add(f.ticker);
  for (const [ticker, [theme, rank]] of Object.entries(snapshot.funds)) if (rank != null && rank <= 3) (was[theme] ??= new Set()).add(ticker);
  const order = [...view.data.themes, ...view.data.no_eligible_themes].map(t => t.theme);
  return [...new Set([...Object.keys(now), ...Object.keys(was)])].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(theme => ({
    theme, entered: [...now[theme] ?? []].filter(t => !was[theme]?.has(t)).sort(), left: [...was[theme] ?? []].filter(t => !now[theme]?.has(t)).sort() }))
    .filter(move => move.entered.length || move.left.length);
}

function renderMoves() {
  const { base, month, today } = view.history;
  if (!base) { $('#moves-body').innerHTML = '<p>No ranking history yet. It builds up with each daily run.</p>'; return; }
  const days = Math.round((Date.parse(today) - Date.parse(base.date)) / DAY);
  const moves = top3Moves(view.data.funds, base);
  $('#moves-body').innerHTML = `<p>Since ${base.date}${base === month ? '' : `; only ${days} days of history so far`}.</p>`
    + (moves.length ? `<ul>${moves.map(m => `<li><strong>${esc(m.theme)}</strong>: ${[
      m.entered.length ? `entered the top 3: ${m.entered.map(esc).join(', ')}` : '', m.left.length ? `left the top 3: ${m.left.map(esc).join(', ')}` : ''].filter(Boolean).join('; ')}</li>`).join('')}</ul>`
      : '<p>No fund entered or left a top 3.</p>');
}

// Rank-over-time line for one fund: every snapshot before today, plus today's run. Reuses chartSvg (rank axis, 1 at the top).
async function rankChart(fund) {
  const { dates, today } = view.history;
  const early = dates.length ? await Promise.all(dates.map(loadSnapshot)).catch(() => []) : [];
  const points = early.map((funds, i) => [dates[i], funds[fund.ticker]?.[1]]).concat([[today, fund.rank]]).filter(([, rank]) => rank != null);
  if (points.length < 2) return { summary: `Not enough ranking history for ${fund.ticker} yet (needs two daily runs with a rank).` };
  const summary = `${fund.ticker} rank in its theme, 1 = best, daily-run weights: ${points[0][1]} on ${points[0][0]} to ${points.at(-1)[1]} on ${points.at(-1)[0]}.`;
  const series = [{ ticker: fund.ticker, dates: points.map(p => p[0]), values: points.map(p => p[1]), color: SERIES_COLORS[0] }];
  return { svg: `<h3 class="chart-sub">Rank in theme over time (1 = best, daily-run weights)</h3>${chartSvg(series, null, null, summary, true)}`, summary };
}

async function load() {
  try {
    const response = await fetch('data/screen.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    view.data = data;
    view.windows = Object.fromEntries(data.themes.map(t => [t.theme, t.window]));
    $('#status').textContent = `${data.synthetic ? 'SYNTHETIC DEMO — not market data. ' : ''}Generated ${data.generated_at}. ${data.themes.length + data.no_eligible_themes.length} themes, ${data.funds.length} funds; ${data.failed_fetches.length} failed fetches.`;
    await loadHistory(data.generated_at.slice(0, 10));
    renderControls();
    renderHead();
    renderMoves();
    renderWeights();
  } catch (error) {
    $('#status').textContent = `Cannot load screen: ${error.message}. Run the pipeline first and serve site/ over HTTP.`;
  }
}
load();
