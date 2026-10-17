const money = value => value == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact' }).format(value);
const number = value => value == null ? '—' : value.toFixed(2);
const percent = value => value == null ? '—' : `${(value * 100).toFixed(2)}%`;

function render(data) {
  const body = document.querySelector('#funds');
  body.replaceChildren();
  const funds = data.funds.filter(f => document.querySelector('#all').checked || (f.rank != null && f.rank <= 3));
  for (const theme of data.themes) {
    headingRow(body, `${theme.group} — ${theme.theme}: ${theme.window ? `shared performance window ${theme.window.start} to ${theme.window.end} (${theme.window.observations} aligned observations)` : 'performance unmeasured'}`);
    renderFunds(body, funds.filter(f => f.theme === theme.theme));
  }
  // SPEC 5.6: listed separately, candidates and failure reasons always shown.
  headingRow(body, 'Themes with no eligible fund');
  for (const theme of data.no_eligible_themes) {
    headingRow(body, `${theme.group} — ${theme.theme}${theme.candidates.length ? '' : ': no candidates'}`);
    for (const candidate of theme.candidates) {
      const row = document.createElement('tr');
      for (const value of [candidate.ticker, candidate.name, candidate.status]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      body.append(row);
    }
  }
}

function headingRow(body, text) {
  const row = document.createElement('tr');
  const cell = document.createElement('th');
  cell.colSpan = 11;
  cell.scope = 'colgroup';
  cell.textContent = text;
  row.append(cell);
  body.append(row);
}

function renderFunds(body, funds) {
  for (const fund of funds) {
    const row = document.createElement('tr');
    const flags = [fund.status, fund.new ? '🆕' : '', fund.performance_unmeasured ? '†' : '', fund.stale ? 'stale market data' : '', fund.assets_stale ? 'stale assets' : ''].filter(Boolean).join(' · ');
    const values = [fund.rank ?? '—', fund.ticker, fund.name, fund.first_trade_date,
      `${money(fund.net_assets)}${fund.assets_source !== 'Yahoo totalAssets' ? '*' : ''} (${fund.assets_as_of})`,
      percent(fund.expense_ratio), percent(fund.cumulative_return), number(fund.ratio), money(fund.dollar_volume), number(fund.score), flags];
    values.forEach((value, i) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      if (i === 1 && fund.issuer_url) {
        const url = new URL(fund.issuer_url);
        if (url.protocol === 'https:') {
          const link = document.createElement('a');
          link.href = url.href;
          link.textContent = value;
          cell.replaceChildren(link);
        }
      }
      if (i === 4) cell.title = fund.assets_source;
      row.append(cell);
    });
    body.append(row);
  }
}

async function load() {
  try {
    const response = await fetch('data/screen.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    document.querySelector('#status').textContent = `${data.synthetic ? 'SYNTHETIC DEMO — not market data. ' : ''}Generated ${data.generated_at}. ${data.themes.length + data.no_eligible_themes.length} themes, ${data.funds.length} funds; ${data.failed_fetches.length} failed fetches.`;
    document.querySelector('#all').addEventListener('change', () => render(data));
    render(data);
  } catch (error) {
    document.querySelector('#status').textContent = `Cannot load screen: ${error.message}. Run the pipeline first and serve site/ over HTTP.`;
  }
}
load();
