# Issue 8: Ranking history

## Delivered
- `pipeline/__main__.py`: `write_history` runs after checks pass, next to the screen.json publish. It writes `site/data/history/<UTC run date>.json` (compact `{date, funds: {TICKER: [theme, rank, score(2dp), net_assets(whole $)]}}`) and `history/index.json` (all dates, oldest first, built from the folder). Same-day rerun overwrites. `write_json` got a `compact` flag.
- `refresh.yml` needed no change: `git add site/data` already covers `history/`.
- `site/app.js` (small separate functions): `Rank vs 1 week` and `Rank vs 1 month` columns (▲n / ▼n / = / —, sortable, tooltip names the snapshot used); `top3Moves` + `renderMoves` for the "Top 3 changes in the last 30 days" panel; `rankChart` adds a rank-over-time line to each fund's chart panel by reusing `chartSvg` (new optional `rank` flag: rank 1 at the top, integer ticks). No library.
- `site/index.html`: new `#moves` section with the rules and reasons in plain English. `site/style.css`: two lines.

## Rules as built
- 1 week / 1 month = nearest snapshot on or before run date minus 7 / 30 days. "Today" is the run date of screen.json (not the browser clock), so a stale site still compares consistently.
- Rank change and the rank line use pipeline (default-weight) ranks, never live-slider ranks. The UI says so.
- Top-3 panel: baseline = 1-month snapshot; if none is that old, the oldest snapshot is used and the panel says "only N days of history so far". Top 3 is fixed at 3, independent of the Top N slider. Compared per theme, so a fund that changes theme shows as left/entered.
- No history, missing snapshot, or no rank then or now: "—".

## Verification
- `python3 -m pytest -q tests`: 49 passed (3 new in `tests/test_history.py`).
- `node --test "tests/*.test.cjs"`: 38 passed (8 new in site.test.cjs; existing tests updated for two new columns before "Status / flags", and the harness counts history fetches apart from price fetches).
- Stub run of 360 funds plus 6 synthetic older snapshots, served with `python3 -m http.server`, checked in Chrome: columns, moves panel and rank line render, no console errors.
- Snapshot size: 19.7 KB per day for 360 funds (about 20 KB for 364), 4.7 KB gzipped. About 7 MB a year in git.
- Every new function has a caller (grep checked).

## Deferred
- Rank line fetches every snapshot on click. Fine for months; a year is about 7 MB raw. Fix when needed: monthly rollups or a per-fund file.
- A snapshot listed in index.json but missing (404) turns the whole history off silently.

## Contract changes
None. The "History snapshots" section is followed as written (path `site/data/history/`).

## Questions for Andy
- Rank line skips days when a fund was unranked (it connects across the gap). OK, or break the line?
- The week/month change columns sit just before Status / flags. Preferred placement?
