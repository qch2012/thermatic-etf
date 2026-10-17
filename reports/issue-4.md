# Issue #4: main screen

Branch: `feat/4-main-screen` (stacked on `feat/3-full-method`). Not merged, not pushed.

## Delivered

- `site/app.js` rewritten around one `COLUMNS` list (label, sort value, cell). The header and every row, including rows for themes with no eligible fund, are built from it, so cells always line up with the headers.
- All SPEC §6.1 columns: rank, ticker (issuer link from `issuer_url`, plain ticker when missing), name, launched, net assets with `*` source marker and as-of date (tooltip names the source), fee, window (theme window dates, measured funds only), return, ratio, avg daily $ volume, top 3 holdings (`—` until the holdings ticket fills `top_holdings`), score, status / flags.
- Flags: 🆕, †, "stale market data", "stale assets", plus the gate status.
- Grouping: group heading row, then theme heading rows (window, eligible of candidates), then funds.
- Sorting: column-heading buttons sort inside each theme; click again to flip; missing values go last; `aria-sort` set.
- Filters: group, theme, text (ticker or name), 🆕 only, hide under $50M.
- Toggle: Top 3 / All eligible / All screened.
- Themes with no eligible fund: separate section after the main themes, same 13 columns, candidate tickers linked like the main table, status column shows the failed gate. The section heading is hidden when nothing in it is visible.
- Page text: "Scores ... are not comparable across themes" near the controls.
- `docs/contract.md`: added the reserved `top_holdings` field and a "How the site reads it" section.

### 🆕 caveat

`method.py` is unchanged. The site treats a fund as 🆕 only when `new && age != null`. "No price data" funds have `new: true` but no `age`, so they get no flag and the 🆕-only filter skips them. I used `age` rather than matching the status text because the contract says `age` is present only when there is price data.

## Verification

- `python3 -m pytest -q tests` → 19 passed, 4 subtests passed.
- `node --test "tests/*.test.cjs"` → 7 passed, 0 failed.
  - "every number on the main screen matches a real pipeline run": runs `python3 -m pipeline` with the stub adapter on `tests/fixtures/nasdaqtraded_2026-10-17_seed_tickers.txt` (360 funds). Then it checks every displayed cell against the JSON by parsing the shown text back and comparing within display rounding: rank, name, launched, net assets, `*` marker, as-of, fee, window, return, ratio, volume, score, issuer link. It also checks that the Top 3 row count equals the sum of min(3, eligible).
  - Hand-fixture tests with literal expected values cover column alignment, the no-eligible section, the toggle, every filter, sorting and flags.
- `node --check site/app.js` → ok.
- Browser smoke test (Chrome, `python3 -m http.server` in `site/`, the live Yahoo `screen.json` from 2026-10-17): 13 headers, every row has 13 cells; Top 3 = 111 rows, All screened = 364; 🆕 only = 77 rows and no "No price data" rows; sort by net assets sets `aria-sort`; no-eligible rows aligned with links. Narrow-width (390 px) layout was not checked.

## Deferred

- Top 3 holdings data (holdings ticket). The column and the contract field are ready.
- Stale banner, Method panel link, live weights, charts, rank history: later tickets.
- 390 px check.

## Questions for Andy

1. **Hide under $50M** keeps funds with unknown net assets visible (5 "No net-asset data" funds). Should they be hidden too?
2. **No-eligible section and the toggle:** it shows every candidate in all three modes (SPEC 5.6 says to list them with reasons). OK, or should Top 3 hide the candidate rows and show only theme names?
3. **Score precision:** shown with 1 decimal (it was 2). OK?

## Contract freeze (follow-up commit)

Pipeline (`pipeline/__main__.py`; `method.py` unchanged):
- Price files `site/data/prices/<TICKER>.json` = `{ticker, dates, adjusted_close}`, last 3 calendar years up to each fund's last adjusted close, for every fund with price data. Days without an adjusted close are left out. Written atomically after the 90% check. Prices are now written before they are dropped from the fund records.
- Top-level `data_as_of`: latest price date across funds.
- Top-level `weights` `{size: 0.4, cost: 0.2, performance: 0.4}`. They are a copy of the numbers in `method.score`, because method.py has them inline and I didn't change it. A test checks they reproduce every eligible fund's score from its percentiles.

Contract (`docs/contract.md`):
- New sections: Score and rank (formula order, plus tie-break: score desc, net assets desc, ticker asc), Price files (#6), Holdings files (reserved, #9), History snapshots (reserved, #8/#7), Method panel (#12 takes rules from SPEC §5 wording, not JSON).

Site:
- `new URL()` wrapped in try/catch; an unparsable issuer URL shows the plain ticker.
- The Theme dropdown lists only the chosen group's themes; a selected theme outside the new group is cleared.

Verification:
- `python3 -m pytest -q tests` → 20 passed, 4 subtests passed (new: `test_price_files_data_as_of_and_weights`, literal dates 2023-01-02 to 2026-01-02, 785 days).
- `node --test "tests/*.test.cjs"` → 9 passed, 0 failed (new: bad issuer URL, theme narrowing).
- Stub CLI run on the seed-ticker fixture: 360 funds, 360 price files; `data_as_of` 2026-01-02; MJ prices 2023-01-02 to 2026-01-02, 785 days.

Questions for Andy:
4. Price files of funds that leave the universe are not deleted, so `site/data/prices/` only grows. Prune them each run?
5. History snapshots are named by the run's UTC date, not `data_as_of`, so a Saturday rerun makes a Saturday file. OK?
