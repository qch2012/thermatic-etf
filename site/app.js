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
  weights: null, topN: 3, live: new Map() };
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
  { label: 'Name', value: f => f.name, cell: f => f.name },
  { label: 'Launched', value: f => f.first_trade_date, cell: f => f.first_trade_date ?? '—' },
  { label: 'Net assets', value: f => f.net_assets, cell: f => `${money(f.net_assets)}${f.assets_source !== 'Yahoo totalAssets' ? '*' : ''} · ${f.assets_as_of}`, title: f => `Source: ${f.assets_source}` },
  { label: 'Fee', value: f => f.expense_ratio, cell: f => percent(f.expense_ratio) },
  { label: 'Window', value: f => windowOf(f)?.start, cell: f => windowOf(f) ? `${windowOf(f).start} to ${windowOf(f).end}` : '—' },
  { label: 'Return', value: f => f.cumulative_return, cell: f => percent(f.cumulative_return) },
  { label: 'Ratio', value: f => f.ratio, cell: f => number(f.ratio) },
  { label: 'Avg daily $ volume', value: f => f.dollar_volume, cell: f => money(f.dollar_volume) },
  { label: 'Top 3 holdings', value: null, cell: f => f.top_holdings?.map(h => `${h.name} ${percent(h.weight)}`).join(', ') || '—' },
  { label: 'Score', value: scoreOf, cell: f => number(scoreOf(f), 1) },
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

function headingRow(body, text, className) {
  const row = document.createElement('tr');
  const cell = document.createElement('th');
  cell.colSpan = COLUMNS.length;
  cell.scope = 'colgroup';
  cell.className = className;
  cell.textContent = text;
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
  const funds = view.data.funds;
  let group = null;
  for (const theme of view.data.themes) {
    const members = sorted(funds.filter(f => f.theme === theme.theme && visible(f, view.mode)));
    if (!members.length) continue;
    if (theme.group !== group) headingRow(body, group = theme.group, 'group');
    const window = theme.window ? `shared performance window ${theme.window.start} to ${theme.window.end} (${theme.window.observations} aligned observations)` : 'performance unmeasured';
    headingRow(body, `${theme.group} — ${theme.theme}: ${window}; ${theme.eligible} eligible of ${theme.candidates}`, 'theme');
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

async function load() {
  try {
    const response = await fetch('data/screen.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    view.data = data;
    view.windows = Object.fromEntries(data.themes.map(t => [t.theme, t.window]));
    $('#status').textContent = `${data.synthetic ? 'SYNTHETIC DEMO — not market data. ' : ''}Generated ${data.generated_at}. ${data.themes.length + data.no_eligible_themes.length} themes, ${data.funds.length} funds; ${data.failed_fetches.length} failed fetches.`;
    renderControls();
    renderHead();
    renderWeights();
  } catch (error) {
    $('#status').textContent = `Cannot load screen: ${error.message}. Run the pipeline first and serve site/ over HTTP.`;
  }
}
load();
