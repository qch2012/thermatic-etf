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

// Chart periods: [key, button text, calendar days]. Days match the pipeline's trend (TREND_DAYS).
// YTD starts at the previous year's last close (Dec 31 or the last trading day before it).
const CHART_PERIODS = [['1m', '1M', 30], ['3m', '3M', 91], ['6m', '6M', 182], ['ytd', 'YTD', null], ['1y', '1Y', 365]];
const periodStart = (end, period) => {
  const days = CHART_PERIODS.find(p => p[0] === period)[2];
  return days ? new Date(Date.parse(end) - days * 864e5).toISOString().slice(0, 10) : `${end.slice(0, 4) - 1}-12-31`;
};

// Chart start: the period's start before `end`, or the first date all funds share when any of them is younger than that.
function chartStart(firstDates, end, period = '1y') {
  return [periodStart(end, period), ...firstDates].sort().at(-1);
}

// A price file from `start` (default one year before `end`) to `end`, rebased to 100 at the last close on or before start.
// null if it begins after start.
function rebaseYear(dates, closes, end, start = periodStart(end, '1y')) {
  let i = -1;
  while (i + 1 < dates.length && dates[i + 1] <= start) i++;
  if (i < 0 || !(closes[i] > 0)) return null;
  const last = dates.findLastIndex(d => d <= end);
  return { dates: dates.slice(i, last + 1), values: closes.slice(i, last + 1).map(v => v / closes[i] * 100) };
}

if (typeof module !== 'undefined') module.exports = { trendShade, themeTrend, bucket, rebaseYear, chartStart, TREND_PERIODS };

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

  // Chart over the chosen period (1M, 3M, 6M, YTD or 1Y) (or since the funds' first shared date, if one is younger), of some funds plus
  // the benchmark (dashed), each labelled at its end; no other lines. Used for a theme's top 3 and for the defensive sectors.
  // The period buttons redraw it; the choice carries over to the next chart opened.
  // Drawing, price loading and live ranks are the Funds tab's (app.js loadPrices / chartSvg / rankOf, shared globals),
  // so the top 3 follow the score-weight sliders.
  const BENCHMARK_COLOR = '#18232c';
  const LINE_COLORS = [...SERIES_COLORS, '#1a7f5a'];  // 4th line for the four defensive sectors
  let benchmark = null, benchmarkTrend = null;  // screen.json `benchmark` (QQQ) and its `benchmark_trend`
  let period = '1y';
  const renderChart = async (box, funds, benchmark, label) => {
    const token = box.dataset.token = String(Math.random());  // a later click wins over a slow load
    box.replaceChildren(el('p', 'Loading chart…', 'note'));
    const tickers = funds.concat(benchmark ? [benchmark] : []);
    const files = (await Promise.allSettled(tickers.map(loadPrices))).map(r => r.status === 'fulfilled' ? r.value : null);
    if (box.dataset.token !== token) return;
    const end = files.filter(Boolean).map(f => f.dates.at(-1)).sort().at(-1);
    const start = chartStart(files.slice(0, funds.length).filter(Boolean).map(f => f.dates[0]), end, period);
    const series = [], notes = [];
    tickers.forEach((ticker, i) => {
      const line = files[i] && rebaseYear(files[i].dates, files[i].adjusted_close, end, start);
      if (!line) return notes.push(`${ticker}: ${files[i] ? `no price on ${start}, not drawn` : 'no price file'}`);
      const isBenchmark = i === funds.length;
      series.push({ ticker, ...line, color: isBenchmark ? BENCHMARK_COLOR : LINE_COLORS[i], dash: isBenchmark });
    });
    if (!series.length) return box.replaceChildren(el('p', `No chart: ${notes.join('; ')}.`, 'note'));
    const name = CHART_PERIODS.find(p => p[0] === period)[1];
    const summary = `${label} and ${benchmark ?? 'no benchmark'}, ${start === periodStart(end, period) ? (period === 'ytd' ? 'year to date' : `last ${name}`) : `from ${start} (first date all of them share, since one is younger than ${name})`} to ${end}, rebased to 100.${notes.length ? ` ${notes.join('; ')}.` : ''}`;
    // Legend carries each line's end value, since the lines have no labels of their own.
    const legend = series.map(s => `<li><i style="${s.dash ? `border-top:2px dashed ${s.color};height:0` : `background:${s.color}`}"></i>`
      + `${esc(s.ticker)} <b>${s.values.at(-1).toFixed(0)}</b>${s.dash ? ' (benchmark)' : ''}</li>`).join('');
    const buttons = el('div', null, 'periods');
    for (const [key, text] of CHART_PERIODS) {
      const button = el('button', text);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(key === period));
      button.addEventListener('click', () => { period = key; renderChart(box, funds, benchmark, label); });
      buttons.append(button);
    }
    box.innerHTML = `<ul class="legend">${legend}</ul>${chartSvg(series, null, 100, summary)}`;
    box.prepend(buttons);
    box.append(el('p', summary, 'note'));
  };

  // Snapshot of one fund under the chart. Formatting and the issuer link are the Funds tab's (app.js money / percent /
  // tickerCell, shared globals), so numbers read the same on both tabs.
  const renderSnapshot = (box, fund) => {
    const card = el('article', null, 'snapshot');
    const head = el('header');
    head.append(el('h3', fund.name), el('p', `${fund.theme} · rank ${rankOf(fund)} of eligible · score ${number(scoreOf(fund), 1)}`, 'snapshot-sub'));
    const link = tickerCell(fund);
    head.prepend(typeof link === 'string' ? el('span', link, 'snapshot-ticker') : Object.assign(link, { className: 'snapshot-ticker', title: 'Issuer fund page' }));
    const stats = el('dl', null, 'snapshot-stats');
    const stat = (label, value, note) => {
      const item = el('div');
      item.append(el('dt', label), el('dd', value));
      if (note) item.append(el('p', note, 'snapshot-note'));
      stats.append(item);
    };
    stat('Launched', fund.first_trade_date ?? '—', fund.age != null ? `${fund.age.toFixed(1)} years old` : null);
    stat('Net assets', money(fund.net_assets), `${fund.assets_source} · ${fund.assets_as_of}`);
    stat('Expense ratio', percent(fund.expense_ratio), fund.expense_ratio != null ? `$${Math.round(fund.expense_ratio * 10000)} a year per $10,000 held` : null);
    stat('Avg daily $ volume', money(fund.dollar_volume), 'Close × volume, last 63 trading days');
    card.append(head, stats);
    box.replaceChildren(card);
  };

  // Breakdown for one theme: the eligible-fund median, then its eligible funds by rank (top 3 highlighted), then the chart.
  const renderDetail = (theme, all, eligibleCount, trend) => {
    all = all.filter(f => f.status === 'Eligible').sort((a, b) => rankOf(a) - rankOf(b));
    const detail = document.getElementById('trend-detail');
    const table = el('table', null, 'heatmap');
    table.append(el('caption', `${theme}: ${eligibleCount} eligible fund${eligibleCount === 1 ? '' : 's'}. Highlighted: top 3 by score.`));
    const head = el('tr');
    ['Rank', 'Fund', ...TREND_PERIODS.map(p => p[1])].forEach(t => head.append(el('th', t)));
    table.createTHead().append(head);
    const body = table.createTBody();
    const median = el('tr', null, 'median');
    median.append(el('td'), el('td', 'Median (eligible)'));
    returnCells(median, trend);
    body.append(median);
    for (const fund of all) {
      const row = el('tr', null, rankOf(fund) <= 3 ? 'top' : '');
      row.append(el('td', rankOf(fund)));
      const pick = Object.assign(el('button', fund.ticker, 'chart-link'), { type: 'button', title: `${fund.name}: show snapshot` });
      pick.setAttribute('aria-pressed', 'false');
      pick.addEventListener('click', () => {
        table.querySelectorAll('button[aria-pressed=true]').forEach(b => b.setAttribute('aria-pressed', 'false'));
        pick.setAttribute('aria-pressed', 'true');
        renderSnapshot(snapshot, fund);
      });
      const cell = el('td');
      cell.append(pick);
      row.append(cell);
      returnCells(row, fund.trend);
      body.append(row);
    }
    const chart = el('div', null, 'trend-chart');
    const snapshot = el('div', null, 'snapshot-box');
    snapshot.append(el('p', 'Click a fund name above for its snapshot.', 'note'));
    detail.replaceChildren(table, chart, snapshot);
    renderChart(chart, all.slice(0, 3).map(f => f.ticker), benchmark, 'Top 3 by score');
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
    if (benchmarkTrend) {  // the growth benchmark, to compare against
      const row = el('tr', null, 'benchmark');
      row.append(el('td', 'Benchmark'), el('td', benchmark));
      returnCells(row, benchmarkTrend);
      body.append(row);
    }
    const chart = el('div', null, 'trend-chart');
    document.getElementById('trend-detail').replaceChildren(table, chart);
    renderChart(chart, reference.map(r => r.ticker), benchmark, 'Defensive sectors');
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
    benchmark = data.benchmark ?? null;
    benchmarkTrend = data.benchmark_trend ?? null;
    render(data.funds, data.themes.map(t => t.theme), data.reference ?? []);
  }).catch(error => {
    document.getElementById('trend-body').textContent = `Cannot load trend: ${error.message}`;
  });
}
