const money = value => value == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact' }).format(value);
const number = value => value == null ? '—' : value.toFixed(2);
const percent = value => value == null ? '—' : `${(value * 100).toFixed(2)}%`;

function render(data) {
  const body = document.querySelector('#funds');
  body.replaceChildren();
  const funds = data.funds.filter(f => document.querySelector('#all').checked || (f.rank != null && f.rank <= 3));
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
    document.querySelector('#theme').textContent = `${data.group} — ${data.theme}`;
    document.querySelector('#status').textContent = `${data.synthetic ? 'SYNTHETIC DEMO — not market data. ' : ''}Generated ${data.generated_at}. ${data.funds.length} funds; ${data.failed_fetches.length} failed fetches.`;
    document.querySelector('#window').textContent = data.window ? `Shared performance window: ${data.window.start} to ${data.window.end} (${data.window.observations} aligned observations).` : 'Performance unmeasured for this theme.';
    document.querySelector('#all').addEventListener('change', () => render(data));
    render(data);
  } catch (error) {
    document.querySelector('#status').textContent = `Cannot load screen: ${error.message}. Run the pipeline first and serve site/ over HTTP.`;
  }
}
load();
