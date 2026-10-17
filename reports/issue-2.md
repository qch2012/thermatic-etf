# Issue #2 — one-theme tracer

Branch: `feat/2-theme-tracer`, created from the existing `spike/yahoo-actions` checkout. No merge or deployment performed.

## Delivered

- `python -m pipeline`: Nasdaq directory → unchanged classification config → selected-theme source fetches → SPEC §5 gates/aligned performance/percentile scores → atomic site JSON.
- `config/settings.yaml` chooses the theme and Yahoo/stub adapter. No rule changes.
- Yahoo uses one cookie session, ~3.3 requests/second, bounded exponential retries for 429/5xx/network failures.
- Provider-separated last-good caches; stale fallback and <90% success publication guard. Uncached failures do not publish or silently drop funds.
- Bare, local-asset-only table shows top three or all screened funds, scores, gate failures, shared window, source/date markers, issuer links, and stale/new/unmeasured flags.

## Verification

- Live Yahoo run: 19 Semiconductors candidates, 19 successful fetches, 11 eligible; generated `site/data/screen.json` locally.
- Live Nasdaq directory + stub run: 19 candidates; generated separate synthetic JSON using only an alternative settings file with `data_source: stub`.
- Live shared performance window: 2025-10-01 through 2026-10-16, 263 common observations.
- 17 Python tests pass: gates/order/boundaries, classifier baseline, aligned dates, exact elapsed time and annualization, sample volatility, percentile ties, sole-fund score, neutral missing values, adapter parsing/switching, throttling/retries, stale fallback and failed-publish preservation.
- 2 Node tests pass: top-three/all toggle, issuer links, literal text rendering, synthetic label, missing-data error. JavaScript syntax check passes.
- HTTP smoke check passes for the page, JavaScript, CSS, and generated live Yahoo JSON.
- No real-browser visual/keyboard test or deployment test performed.

## Review fixes

- Missing adjusted closes now retain valid close/volume observations for age and the last-63-day liquidity gate. Performance intersects only dates with available adjusted closes. Regression tests reproduce the false pass ($640,952 instead of $490,000), verify aligned performance dates, and cover entirely unavailable adjusted prices.
- A failed optional Yahoo quote fallback now preserves successful profile fields and allows configured issuer net assets to be used. Errors are logged and retained in per-fund JSON `warnings`; complete history/profile failures still follow the existing stale-cache/publication safeguards. Regression tests cover LAZR's issuer override, network/HTTP errors, timeouts, malformed JSON, and Yahoo-reported errors.
- Each fix was tested failing before implementation. Final verification: 17 Python tests and 2 Node tests pass. The earlier live run was not repeated for these fixes.

## Classification questions — unchanged, awaiting Andy

The supplied config does not reproduce two supplied seed assignments when applied to the seed names. Regression tests explicitly record these existing exceptions rather than silently changing rules:

1. **WDEF**: seed name `WisdomTree Trust` has no thematic match; seed theme is Aerospace & defense. Should WDEF get an override, or should we rely on a more descriptive live directory name?
2. **ARKW**: `ARK Next Generation Technology ETF` matches `\bgene` in the Genomics & gene editing rule before the broad `next ?gen` rule. Seed theme is Internet, e-commerce & social media. Should ARKW get an override and/or should the gene rule be tightened in a separate re-screen?

No new classification judgments were made.

## Missing issuer links from the live semiconductor run

Displayed as plain tickers, not Yahoo links:

ACHP, AIFR, AINF, CHIP, CHPS, CHPX, CPU, FTXL, KCHP, KSMH, KSTR, PSI, SHOC, SMHC, SMHX, XSD.

ACHP and CPU had no net-asset data and correctly received `No net-asset data` status. Missing data was not guessed.

## Deliberately deferred

This is not the full SPEC acceptance suite: no holdings/overlap, multi-theme view, charts, live weights, ranking history, schema validation, daily workflow, automatic failure issues, or hosting/privacy setup. No Method panel is present. Zero-volatility ratios are treated as unmeasured to avoid publishing non-finite JSON. Generated data/cache are local and ignored until the daily-refresh stage defines their commit lifecycle.
