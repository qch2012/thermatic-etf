// Holdings overlap (SPEC 6.5). Reads site/data/holdings/<TICKER>.json lazily. The pipeline already matched
// companies across funds (each equity row has a `company` key; cash and derivatives have null), so this file
// only sums weights. Funds without a holdings file show "full holdings unavailable", never Yahoo's top 10.
const HIGH = 0.3;        // pairs at or above 30% are highlighted
const MAX_GAP_DAYS = 7;  // flag pairs whose holdings dates differ by more than a week

// Company key -> {name, weight}, listings and share classes of one company summed within the fund.
function companyWeights(file) {
  const companies = new Map();
  for (const h of [...file.holdings].sort((x, y) => y.weight - x.weight)) {
    if (!h.company) continue;
    const entry = companies.get(h.company) ?? { name: h.name, weight: 0 };
    entry.weight = Math.round((entry.weight + h.weight) * 1e10) / 1e10;
    companies.set(h.company, entry);
  }
  return companies;
}

// overlap(A, B) = sum over shared companies of min(weight in A, weight in B).
function overlap(a, b) {
  const wa = companyWeights(a), wb = companyWeights(b);
  const shared = [...wa].filter(([key]) => wb.has(key))
    .map(([key, { name, weight }]) => ({ name, a: weight, b: wb.get(key).weight, min: Math.min(weight, wb.get(key).weight) }))
    .sort((x, y) => y.min - x.min);
  return { value: shared.reduce((sum, s) => sum + s.min, 0), shared };
}

const daysApart = (a, b) => Math.abs(Date.parse(a.as_of) - Date.parse(b.as_of)) / 86400e3;

if (typeof module !== 'undefined') module.exports = { overlap, daysApart, HIGH, MAX_GAP_DAYS };

if (typeof document !== 'undefined' && document.getElementById('overlap')) {
  const files = new Map();
  const pct = value => `${(value * 100).toFixed(1)}%`;
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  // A fund has a holdings file exactly when screen.json gives it top_holdings (docs/contract.md).
  const load = fund => {
    if (!fund.top_holdings) return Promise.resolve(null);
    if (!files.has(fund.ticker)) {
      files.set(fund.ticker, fetch(`data/holdings/${fund.ticker}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null));
    }
    return files.get(fund.ticker);
  };
  const dateNote = (a, b) => {
    const gap = daysApart(a, b);
    return gap > MAX_GAP_DAYS ? `as-of dates differ by ${gap} days` : '';
  };
  const label = (fund, file) => file ? `${fund.ticker} (as of ${file.as_of}${file.stale ? ', stale' : ''})` : `${fund.ticker}: full holdings unavailable`;

  async function renderMatrix(funds) {
    const box = document.getElementById('overlap-matrix');
    const loaded = await Promise.all(funds.map(load));
    const table = el('table');
    table.append(el('caption', 'Overlap between funds in this theme. Highlighted: 30% or more. ⚠: holdings dates more than 7 days apart.'));
    const head = el('tr');
    head.append(el('th', 'Fund'));
    funds.forEach(f => head.append(Object.assign(el('th', f.ticker), { scope: 'col' })));
    table.append(head);
    funds.forEach((fa, i) => {
      const row = el('tr');
      row.append(Object.assign(el('th', label(fa, loaded[i])), { scope: 'row' }));
      funds.forEach((fb, j) => {
        const a = loaded[i], b = loaded[j];
        if (i === j || !a || !b) return row.append(el('td', '—'));
        const { value } = overlap(a, b);
        const note = dateNote(a, b);
        const cell = el('td', `${pct(value)}${note ? ' ⚠' : ''}`, value >= HIGH ? 'high' : '');
        if (note) cell.title = note;
        row.append(cell);
      });
      table.append(row);
    });
    box.replaceChildren(table);
  }

  async function renderPair(fa, fb) {
    const box = document.getElementById('overlap-pair');
    const [a, b] = await Promise.all([load(fa), load(fb)]);
    const lines = [el('p', `${label(fa, a)} · ${label(fb, b)}`)];
    if (a && b && fa !== fb) {
      const { value, shared } = overlap(a, b);
      const note = dateNote(a, b);
      lines.push(el('p', `Overlap ${pct(value)} across ${shared.length} shared companies${note ? ` · ⚠ ${note}` : ''}`, value >= HIGH ? 'high' : ''));
      const table = el('table');
      table.append(el('caption', 'Shared companies: the smaller of the two weights counts toward overlap.'));
      const head = el('tr');
      ['Company', fa.ticker, fb.ticker, 'Counted'].forEach(t => head.append(Object.assign(el('th', t), { scope: 'col' })));
      table.append(head);
      for (const s of shared) {
        const row = el('tr');
        [s.name, pct(s.a), pct(s.b), pct(s.min)].forEach(t => row.append(el('td', t)));
        table.append(row);
      }
      const scroll = el('div', null, 'table-scroll');
      scroll.append(table);
      lines.push(scroll);
    }
    box.replaceChildren(...lines);
  }

  fetch('data/screen.json').then(r => r.json()).then(data => {
    // Holdings are fetched for eligible funds only (SPEC 4.1).
    const eligible = data.funds.filter(f => f.status === 'Eligible');
    const themes = data.themes.map(t => t.theme);
    const themeSelect = document.getElementById('overlap-theme');
    const pick = [document.getElementById('overlap-a'), document.getElementById('overlap-b')];
    for (const theme of themes) themeSelect.append(Object.assign(el('option', theme), { value: theme }));
    for (const select of pick) {
      for (const f of eligible) select.append(Object.assign(el('option', `${f.ticker} — ${f.theme}`), { value: f.ticker }));
    }
    const members = theme => eligible.filter(f => f.theme === theme);
    // Open on the first theme with two funds that have holdings, so the view shows real numbers at rest.
    const start = themes.find(t => members(t).filter(f => f.top_holdings).length >= 2) ?? themes[0];
    const startPair = members(start).filter(f => f.top_holdings).concat(eligible).slice(0, 2);
    themeSelect.value = start;
    pick.forEach((select, i) => { select.value = startPair[i]?.ticker ?? ''; });
    const byTicker = ticker => eligible.find(f => f.ticker === ticker);
    const pair = () => byTicker(pick[0].value) && byTicker(pick[1].value) && renderPair(byTicker(pick[0].value), byTicker(pick[1].value));
    themeSelect.addEventListener('input', () => renderMatrix(members(themeSelect.value)));
    pick.forEach(select => select.addEventListener('input', pair));
    renderMatrix(members(start));
    pair();
  }).catch(error => {
    document.getElementById('overlap-matrix').textContent = `Cannot load overlap: ${error.message}`;
  });
}
