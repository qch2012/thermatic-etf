// Main screen (SPEC 5.6, 6.1). One table grouped by group → theme. Later panels (live weights, charts,
// method) can change `view` or fund fields and call render(); the table code doesn't need to change.
const $ = selector => document.querySelector(selector);
const money = value => value == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumSignificantDigits: 3 }).format(value);
const number = (value, digits = 2) => value == null ? '—' : value.toFixed(digits);
const percent = value => value == null ? '—' : `${(value * 100).toFixed(2)}%`;

// method.py sets new: true when a fund has no price data (no age); only a known age under 0.5 years is 🆕.
const isNew = fund => fund.new && fund.age != null;
const windowOf = fund => fund.cumulative_return == null ? null : view.windows[fund.theme];

const view = { data: null, windows: {}, mode: 'top3', group: '', theme: '', search: '', newOnly: false, hideSmall: false, sort: null };

const COLUMNS = [
  { label: 'Rank', value: f => f.rank, cell: f => f.rank ?? '—' },
  { label: 'Ticker', value: f => f.ticker, cell: tickerCell },
  { label: 'Name', value: f => f.name, cell: f => f.name },
  { label: 'Launched', value: f => f.first_trade_date, cell: f => f.first_trade_date },
  { label: 'Net assets', value: f => f.net_assets, cell: f => `${money(f.net_assets)}${f.assets_source !== 'Yahoo totalAssets' ? '*' : ''} · ${f.assets_as_of}`, title: f => `Source: ${f.assets_source}` },
  { label: 'Fee', value: f => f.expense_ratio, cell: f => percent(f.expense_ratio) },
  { label: 'Window', value: f => windowOf(f)?.start, cell: f => windowOf(f) ? `${windowOf(f).start} to ${windowOf(f).end}` : '—' },
  { label: 'Return', value: f => f.cumulative_return, cell: f => percent(f.cumulative_return) },
  { label: 'Ratio', value: f => f.ratio, cell: f => number(f.ratio) },
  { label: 'Avg daily $ volume', value: f => f.dollar_volume, cell: f => money(f.dollar_volume) },
  { label: 'Top 3 holdings', value: null, cell: f => f.top_holdings?.map(h => `${h.name} ${percent(h.weight)}`).join(', ') || '—' },
  { label: 'Score', value: f => f.score, cell: f => number(f.score, 1) },
  { label: 'Status / flags', value: f => f.status, cell: flags },
];

function tickerCell(fund) {
  // Issuer page from config/issuer_links.json (via the pipeline); plain ticker when missing.
  if (!fund.issuer_url || new URL(fund.issuer_url).protocol !== 'https:') return fund.ticker;
  const link = document.createElement('a');
  link.href = new URL(fund.issuer_url).href;
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
    && (!view.newOnly || isNew(fund)) && !(view.hideSmall && fund.net_assets != null && fund.net_assets < 50e6)
    && (mode === 'all' || (fund.status === 'Eligible' && (mode === 'eligible' || fund.rank <= 3)));
}

function sorted(funds) {
  if (!view.sort) return funds;
  const { value } = COLUMNS[view.sort.column];
  const sign = view.sort.descending ? -1 : 1;
  // Missing values go last in both directions; ties keep pipeline order (rank).
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
  // SPEC 5.6: listed separately with every candidate and its failed gate, whatever the Top 3 / All toggle says.
  const fundFilter = view.search.trim() || view.newOnly || view.hideSmall;
  let heading = false;
  for (const theme of view.data.no_eligible_themes) {
    if ((view.group && theme.group !== view.group) || (view.theme && theme.theme !== view.theme)) continue;
    const members = sorted(funds.filter(f => f.theme === theme.theme && visible(f, 'all')));
    if (!members.length && (theme.candidates.length || fundFilter)) continue;
    if (!heading) headingRow(body, 'Themes with no eligible fund', 'group'), heading = true;
    headingRow(body, `${theme.group} — ${theme.theme}${theme.candidates.length ? ': status shows why each candidate failed' : ': no candidates'}`, 'theme');
    members.forEach(f => fundRow(body, f));
  }
}

function options(select, values) {
  for (const value of ['', ...new Set(values)]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value || 'All';
    select.append(option);
  }
}

function renderControls() {
  const themes = [...view.data.themes, ...view.data.no_eligible_themes];
  options($('#group'), themes.map(t => t.group));
  options($('#theme'), themes.map(t => t.theme));
  const bind = (id, key, prop) => $(id).addEventListener('input', () => { view[key] = $(id)[prop]; render(); });
  bind('#mode', 'mode', 'value');
  bind('#group', 'group', 'value');
  bind('#theme', 'theme', 'value');
  bind('#search', 'search', 'value');
  bind('#new-only', 'newOnly', 'checked');
  bind('#hide-small', 'hideSmall', 'checked');
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
    render();
  } catch (error) {
    $('#status').textContent = `Cannot load screen: ${error.message}. Run the pipeline first and serve site/ over HTTP.`;
  }
}
load();
