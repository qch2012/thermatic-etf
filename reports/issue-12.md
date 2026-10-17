# Issue #12: Method panel and site polish

Branch: `feat/12-method-panel` (stacked on `feat/6-price-charts`). Not merged, not pushed.

## Delivered

- Method panel (`<section id="method">` at the bottom of `site/index.html`, linked from a "Method" nav link at the top). Written from SPEC section 5 in plain English, in six parts: which funds are screened, the four gates (with the exact status texts), the shared performance window, the numbers shown, the score, what the page shows. 27 rules, each as a rule paragraph followed by a "Why:" paragraph. The wording is static HTML, not read from JSON.
- Responsive: no page-level horizontal scroll at 390 px or 1440 px. At 390 px the table scrolls sideways inside its own region with the Ticker column pinned, and group/theme headings stay in view while scrolling (inner `.stick` span). Smaller padding, larger chart labels and a shorter chart panel at narrow widths.
- Keyboard: every control is a native element with a label, the chart opens focus on "Close chart" and returns it to the trigger, table scroll region is focusable, focus ring from #4 unchanged.
- `noindex,nofollow` meta kept. No CDN, external font or tracker: system fonts, no remote URL in `index.html`, `style.css` or `app.js`.
- Index has comment markers where the status bar (#7) and overlap (#9) sections go. I did not add their script tags or files.

## Verification

- `python3 -m pytest -q tests` -> 20 passed, 4 subtests passed.
- `node --test "tests/*.test.cjs"` -> 24 passed, 0 failed. New tests (red first): every Method rule is followed by a "Why:" paragraph of real length (at least 18 pairs, none without a why); the panel contains every SPEC section 5 number and gate status text, each also checked against SPEC.md; noindex and no absolute or protocol-relative URL in the three site files; every input/select has a label.
- Browser (Chrome, local server, stub run), iframes at 390 px and 1440 px: `scrollWidth` equals the viewport width at both; screenshots checked for the table, the chart panel and the Method panel at 390 px; console shows no errors or warnings.

## Deferred

- No `X-Robots-Tag` header or `robots.txt` (hosting config, outside my files). The meta tag is the only noindex signal; the site is behind Cloudflare Access anyway.
- No dark mode (SPEC 6.7 does not ask).
- The page was checked in Chrome only, and with stub data.

## Questions for Andy

1. **Review the reasons.** SPEC section 5 gives the rules and only a few reasons (dollar volume not scored; the Morningstar grouping). Most "Why:" lines are my wording. In particular the reasons for the 40/20/40 weights, the $100M / $25M / $0.5M thresholds, the 63-day liquidity window, Top 3 with no minimum score, and the 3-year cap on the window. Please correct any that do not match your reasoning.
2. "Drop ... and a short list of named tickers" refers to `exclude_tickers` in `config/themes.yaml`. OK to mention it that way?
