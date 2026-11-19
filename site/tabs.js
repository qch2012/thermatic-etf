// Top-bar links act as tabs: one section at a time, Momentum by default. The URL hash keeps the tab on reload and Back.
const TABS = ['trend', 'screen', 'moves', 'overlap', 'method'];

function showTab() {
  const current = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'trend';
  for (const id of TABS) document.getElementById(id).hidden = id !== current;
  document.body.dataset.tab = current;  // CSS hides the fund chart panel outside the Funds tab
  for (const link of document.querySelectorAll('.topbar nav a')) {
    if (link.hash === `#${current}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  scrollTo(0, 0);
}

addEventListener('hashchange', showTab);
showTab();
