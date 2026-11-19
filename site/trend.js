// Trend heatmap (SPEC 6.8). Reads each fund's `trend` returns from screen.json; display only, never scored.
// Colour depth = return / cap, so a 10% month and a 50% year both read as a strong move.
const TREND_PERIODS = [['1m', '1M', 0.1], ['3m', '3M', 0.2], ['6m', '6M', 0.3], ['1y', '1Y', 0.5]];

// Green for gains, red for losses; alpha grows with the move and stops at 0.6 so the text stays readable.
function trendShade(value, cap) {
  if (value == null) return '';
  const alpha = Math.min(Math.abs(value) / cap, 1) * 0.6;
  return value >= 0 ? `rgba(26, 140, 60, ${alpha.toFixed(2)})` : `rgba(200, 40, 40, ${alpha.toFixed(2)})`;
}

if (typeof module !== 'undefined') module.exports = { trendShade, TREND_PERIODS };

if (typeof document !== 'undefined' && document.getElementById('trend')) {
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };

  const render = (funds, themes) => {
    const table = el('table', null, 'heatmap');
    const head = el('tr');
    ['Fund', ...TREND_PERIODS.map(p => p[1])].forEach(t => head.append(el('th', t)));
    table.append(el('thead'));
    table.tHead.append(head);
    const body = el('tbody');
    for (const theme of themes) {
      const members = funds.filter(f => f.theme === theme);
      if (!members.length) continue;
      if (themes.length > 1) {
        const row = el('tr');
        row.append(Object.assign(el('th', theme, 'theme'), { colSpan: TREND_PERIODS.length + 1 }));
        body.append(row);
      }
      for (const fund of members) {
        const row = el('tr');
        row.append(Object.assign(el('td', fund.ticker), { title: fund.name }));
        for (const [key, , cap] of TREND_PERIODS) {
          const value = fund.trend?.[key];
          const cell = el('td', value == null ? '—' : `${(value * 100).toFixed(1)}%`);
          cell.style.background = trendShade(value, cap);
          row.append(cell);
        }
        body.append(row);
      }
    }
    table.append(body);
    document.getElementById('trend-body').replaceChildren(table);
  };

  fetch('data/screen.json').then(r => r.json()).then(data => {
    // Funds arrive sorted by theme order, then rank (docs/contract.md).
    const funds = data.funds.filter(f => f.status === 'Eligible');
    const themes = data.themes.map(t => t.theme);
    const select = document.getElementById('trend-theme');
    select.append(Object.assign(el('option', 'All themes'), { value: '' }));
    for (const theme of themes) select.append(Object.assign(el('option', theme), { value: theme }));
    const show = () => render(funds, select.value ? [select.value] : themes);
    select.addEventListener('input', show);
    show();
  }).catch(error => {
    document.getElementById('trend-body').textContent = `Cannot load trend: ${error.message}`;
  });
}
