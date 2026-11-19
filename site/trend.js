// Momentum board (SPEC 6.8). Reads each fund's `trend` returns from screen.json; display only, never scored.
// Colour depth = return / cap, so a 10% month and a 50% year both read as a strong move.
const TREND_PERIODS = [['1m', '1M', 0.1], ['3m', '3M', 0.2], ['6m', '6M', 0.3], ['1y', '1Y', 0.5]];

// Each bucket compares last month (short) with the last 3 months (long). Order = board order.
const BUCKETS = [
  ['Rising', 'Up over 1 month and over 3 months.'],
  ['Recovering', 'Up last month after a down 3 months. May be turning up.'],
  ['Fading', 'Down last month after an up 3 months. Losing momentum.'],
  ['Falling', 'Down over 1 month and over 3 months.'],
];

// Green for gains, red for losses; alpha grows with the move and stops at 0.6 so the text stays readable.
function trendShade(value, cap) {
  if (value == null) return '';
  const alpha = Math.min(Math.abs(value) / cap, 1) * 0.6;
  return value >= 0 ? `rgba(26, 140, 60, ${alpha.toFixed(2)})` : `rgba(200, 40, 40, ${alpha.toFixed(2)})`;
}

// Theme return per period = median of its funds, so one wild fund can't drag the whole theme.
function themeTrend(funds) {
  const out = {};
  for (const [key] of TREND_PERIODS) {
    const values = funds.map(f => f.trend?.[key]).filter(v => v != null).sort((a, b) => a - b);
    const mid = values.length >> 1;
    out[key] = !values.length ? null : values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  }
  return out;
}

// null when the theme is too new to have a 1M and 3M return.
function bucket(trend) {
  if (trend['1m'] == null || trend['3m'] == null) return null;
  const short = trend['1m'] >= 0, long = trend['3m'] >= 0;
  return short ? (long ? 'Rising' : 'Recovering') : (long ? 'Fading' : 'Falling');
}

if (typeof module !== 'undefined') module.exports = { trendShade, themeTrend, bucket, TREND_PERIODS };

if (typeof document !== 'undefined' && document.getElementById('trend')) {
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const pct = v => v == null ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;

  const returnCells = (row, trend) => {
    for (const [key, , cap] of TREND_PERIODS) {
      const cell = el('td', pct(trend?.[key]));
      cell.style.background = trendShade(trend?.[key], cap);
      row.append(cell);
    }
  };

  // Breakdown for one theme: the eligible-fund median on top, then every fund in the theme.
  // Funds arrive eligible first by rank, then the rest (docs/contract.md). Top 3 by score are highlighted.
  const renderDetail = (theme, all, eligibleCount, trend) => {
    const detail = document.getElementById('trend-detail');
    const table = el('table', null, 'heatmap');
    table.append(el('caption', `${theme}: ${all.length} funds, ${eligibleCount} eligible. Highlighted: top 3 by score. Rank "—" = not eligible (hover for why).`));
    const head = el('tr');
    ['Rank', 'Fund', ...TREND_PERIODS.map(p => p[1])].forEach(t => head.append(el('th', t)));
    table.createTHead().append(head);
    const body = table.createTBody();
    const median = el('tr', null, 'median');
    median.append(el('td'), el('td', 'Median (eligible)'));
    returnCells(median, trend);
    body.append(median);
    for (const fund of all) {
      const row = el('tr', null, fund.rank != null && fund.rank <= 3 ? 'top' : fund.rank == null ? 'ineligible' : '');
      row.append(Object.assign(el('td', fund.rank ?? '—'), { title: fund.status }));
      row.append(Object.assign(el('td', fund.ticker), { title: fund.name }));
      returnCells(row, fund.trend);
      body.append(row);
    }
    detail.replaceChildren(table);
  };

  // Defensive sector funds (config/settings.yaml `reference`): compared against the themes, never scored.
  const renderReference = reference => {
    const table = el('table', null, 'heatmap');
    table.append(el('caption', 'Defensive sectors: reference only, not screened or scored.'));
    const head = el('tr');
    ['Sector', 'Fund', ...TREND_PERIODS.map(p => p[1])].forEach(t => head.append(el('th', t)));
    table.createTHead().append(head);
    const body = table.createTBody();
    for (const r of reference) {
      const row = el('tr');
      row.append(el('td', r.label), el('td', r.ticker));
      returnCells(row, r.trend);
      body.append(row);
    }
    document.getElementById('trend-detail').replaceChildren(table);
  };

  // One clickable tile; `onClick` fills the detail table below the board.
  const tile = (name, trend, extra, onClick) => {
    const button = el('button', null, 'tile');
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.title = `1M ${pct(trend['1m'])} · 3M ${pct(trend['3m'])}. Click for details.`;
    button.style.background = trendShade(trend['1m'], 0.1);
    button.append(el('span', name, 'name'), el('span', pct(trend['1m']), 'value'));
    if (extra) button.append(el('span', extra, 'tag'));
    button.addEventListener('click', () => {
      document.querySelectorAll('#trend-body .tile[aria-pressed=true]').forEach(t => t.setAttribute('aria-pressed', 'false'));
      button.setAttribute('aria-pressed', 'true');
      onClick();
      // Wide screens: the panel sits beside the tiles. Narrow screens stack it below, so bring it into view there.
      const detail = document.getElementById('trend-detail');
      const box = detail.getBoundingClientRect();
      if (box.top > innerHeight || box.bottom < 0) detail.scrollIntoView({ block: 'start' });
    });
    return button;
  };

  const render = (allFunds, themes, reference) => {
    const rows = themes
      .map(theme => {
        const all = allFunds.filter(f => f.theme === theme);
        const members = all.filter(f => f.status === 'Eligible');
        const trend = themeTrend(members);
        return { theme, all, members, trend, bucket: bucket(trend) };
      })
      .filter(r => r.members.length)
      .sort((a, b) => b.trend['1m'] - a.trend['1m']);

    const board = el('div', null, 'board');
    for (const [name, why] of BUCKETS) {
      const inBucket = rows.filter(r => r.bucket === name);
      const box = el('section', null, `bucket bucket-${name.toLowerCase()}`);
      box.append(el('h3', `${name} (${inBucket.length})`), el('p', why, 'why'));
      const list = el('div', null, 'tiles');
      for (const r of inBucket) list.append(tile(r.theme, r.trend, null, () => renderDetail(r.theme, r.all, r.members.length, r.trend)));
      if (!inBucket.length) list.append(el('p', 'None right now.', 'why'));
      box.append(list);
      board.append(box);
    }
    const tooNew = rows.filter(r => !r.bucket).map(r => r.theme);
    const parts = [];
    if (reference.length) {
      const strip = el('section', null, 'bucket bucket-reference');
      strip.append(el('h3', 'Defensive sectors (reference)'),
        el('p', 'Sectors investors often favour when growth themes fall. Same 1M number and colour; the tag is its bucket. Not scored.', 'why'));
      const list = el('div', null, 'tiles');
      for (const r of reference) list.append(tile(`${r.ticker} ${r.label}`, r.trend, bucket(r.trend) ?? 'Too new', () => renderReference(reference)));
      strip.append(list);
      parts.push(strip);
    }
    parts.push(board);
    if (tooNew.length) parts.push(el('p', `Too new to judge: ${tooNew.join(', ')}.`, 'why'));
    document.getElementById('trend-body').replaceChildren(...parts);
  };

  fetch('data/screen.json').then(r => r.json()).then(data => {
    render(data.funds, data.themes.map(t => t.theme), data.reference ?? []);
  }).catch(error => {
    document.getElementById('trend-body').textContent = `Cannot load trend: ${error.message}`;
  });
}
