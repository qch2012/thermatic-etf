# Issue #7: daily refresh job and checks

Branch: `feat/7-daily-refresh` (stacked on `feat/4-main-screen`). Not merged, not pushed.

## Delivered

- `.github/workflows/refresh.yml`: weekdays 22:30 UTC plus manual run. `permissions: contents: write, issues: write` only. `timeout-minutes: 15`. Steps: checkout, Python 3.12, `pip install`, restore `.cache` (last-good data; saved only on a successful job), `python -m pipeline | tee run.log`, commit `site/data` if changed, and on failure open an issue (or comment on the open "Daily refresh failed" issue) with the run link and the last 30 log lines.
- `pipeline/checks.py` (new): `check(result, previous)` returns blocking errors and log notes. Checks: schema; at least 90% fetched; no theme that had eligible funds in the previous `screen.json` now has none while it has failed fetches; net-asset moves over 50% go to the log (warning, not blocking). Includes a small schema validator (type, required, properties, items, enum, pattern, `$ref`), so no new dependency.
- `docs/screen.schema.json` (new): schema mirroring the contract.
- `pipeline/__main__.py`: checks run after scoring and before any file is written. A failed check raises `CheckFailed`; the CLI prints `Not publishing: <reason>` and exits 1. Price files and `screen.json` are written only after the checks pass.
- Decision A: a fund that fails with no last-good data is published as `No price data` and listed in `failed_fetches`. It no longer blocks. The 90% check still applies.
- Decision B: each publish deletes `prices/<TICKER>.json` for tickers not in the run's `funds`.
- Decision C: `method.py` `new` is now `"age" in fund and fund["age"] < 0.5`. Nothing else in method.py changed. The `new` note in `docs/contract.md` is updated.
- Decision D: `.gitignore` no longer ignores `site/data/` (comment gives the reason); `.cache/` is still ignored.
- `site/status.js` (new) plus one `<div id="data-status">` and one `<script>` in `site/index.html`. Shows "Data as of · Last run · funds · failed fetches (first 10 tickers)". Shows a warning banner (role=alert) when the latest price date is more than 2 weekdays old (no holiday calendar), when there are no prices, or when `screen.json` cannot be read. `app.js` and `style.css` untouched.
- `Stub` adapter: env `STUB_FAIL_RATE` (e.g. `0.2`) makes that share of tickers raise, chosen by a hash of the ticker.
- `docs/contract.md`: documents the no-data fund shape, the nullable fields below, and price-file deletion.

## Verification

- `python3 -m pytest -q tests` -> 30 passed, 4 subtests passed (new: `tests/test_refresh.py`, 10 tests; one old assertion updated for decision A).
- `node --test "tests/*.test.cjs"` -> 13 passed (new: `tests/status.test.cjs`, 4 tests).
- Workflow YAML parses with `yaml.safe_load`; schedule, permissions and timeout read back as specified.
- Local stub run (360-ticker fixture): exit 0, 360 funds, 360 price files.
- Local run with `STUB_FAIL_RATE=0.2`: 76 of 360 failed, `Not publishing: Fewer than 90% of candidates fetched successfully (76 of 360 failed)`, exit 1, `screen.json` and price files byte-identical to before (SHA-1 unchanged).
- Stale banner: unit-tested against a fixed clock (not stale at 2 trading days, stale at 3, stale when `data_as_of` is null or the file is missing).
- Every new function has a caller (grep): `validate`, `check`, `is_type`, `CheckFailed`, `tradingDaysSince`, `describe`, `showStatus`, `mount`.
- Not done by me: a live Actions run. That covers the real issue creation, the push, the cache action, and the under-15-minutes timing. A live local Yahoo run earlier took about 4.5 minutes, so the margin looks fine.

## Contract-change requests (small, already written into `docs/contract.md`; please confirm)

Decision A needs a fund with no data to carry nulls where the contract said "always present":
- `first_trade_date`: date or `null`.
- `fetched_at`: timestamp or `null`.
- Other fields use existing values (`net_assets: null`, `assets_source: "Fetch failed"`, `assets_as_of` = today, `assets_stale: true`).
- Effect on the site: the Launched cell prints the text `null` for such a fund (`app.js` shows `f.first_trade_date` raw). The `app.js` owner should render `?? '—'`. I did not touch app.js.

## Deferred

- History snapshots (`site/data/history/`): the contract says "written by #8 / #7". Not in this ticket's criteria, so not built.
- Issuer holdings step from SPEC 7 (ticket #9).
- No holiday calendar in the stale rule (a long weekend can make the banner appear one day early).

## Questions for Andy

1. Is the contract relaxation above (`first_trade_date`, `fetched_at` nullable) OK?
2. Who writes history snapshots: this ticket or #8?
3. "No theme loses all eligible funds to fetch errors" is measured against the previous published `screen.json`. On the very first run there is no previous file, so the check cannot fire. OK?
4. Repeated failures comment on the one open "Daily refresh failed" issue rather than opening a new one each day. OK?
5. `STUB_FAIL_RATE` is read from the environment inside the stub adapter, not from `settings.yaml`. OK?
