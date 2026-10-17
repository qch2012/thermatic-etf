// Status bar and stale banner (SPEC 6.6). Reads data/screen.json on its own; app.js is not involved.
// "Trading days" = weekdays (no holiday calendar). Stale = more than 2 of them since the latest price date.
const STALE_AFTER = 2;

function tradingDaysSince(asOf, now) {
  let days = 0;
  const day = new Date(`${asOf}T00:00:00Z`);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (day.setUTCDate(day.getUTCDate() + 1); day.getTime() <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    if (day.getUTCDay() % 6 !== 0) days++;
  }
  return days;
}

function describe(data, now) {
  const failed = data.failed_fetches;
  const names = failed.length ? ` (${failed.slice(0, 10).map(f => f.ticker).join(', ')}${failed.length > 10 ? ', …' : ''})` : '';
  const line = `Data as of ${data.data_as_of ?? 'unknown'} · Last run ${data.generated_at.slice(0, 16).replace('T', ' ')} UTC · ${data.funds.length} funds · ${failed.length} failed fetches${names}`;
  const days = data.data_as_of ? tradingDaysSince(data.data_as_of, now) : null;
  const banner = days != null && days <= STALE_AFTER ? null
    : `Stale data: ${days == null ? 'there are no prices' : `the latest prices are from ${data.data_as_of}, ${days} trading days ago`}. The last daily refresh may have failed.`;
  return { line, banner };
}

function mount(parent, tag, text, role) {
  const el = document.createElement(tag);
  el.textContent = text;
  if (role) el.setAttribute('role', role);
  parent.append(el);
  return el;
}

async function showStatus() {
  const root = document.querySelector('#data-status');
  try {
    const response = await fetch('data/screen.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { line, banner } = describe(await response.json(), new Date());
    if (banner) mount(root, 'p', banner, 'alert').setAttribute('style', 'padding:.5rem .75rem;border:2px solid #8a5a00;background:#fff3cd;color:#3d2800;font-weight:bold');
    mount(root, 'p', line);
  } catch (error) {
    mount(root, 'p', `Stale data: cannot read the latest data (${error.message}).`, 'alert');
  }
}

if (typeof module !== 'undefined') module.exports = { describe, tradingDaysSince };
else showStatus();
