# Issue #11: re-screen report generator

Branch: `feat/11-rescreen-report` (on 5320b89). Not merged, not pushed.

## Delivered

- `pipeline/report.py`: `python3 -m pipeline.report [--date D] [--directory saved.txt] [--screen site/data/screen.json] [--holdings-dir ...]` writes `reports/rescreen-DATE.md` plus `reports/rescreen-DATE.universe.csv` (every directory ETF: ticker, name, outcome, theme).
- Sections: new ETFs (classified / excluded / unclassified), possible misses, possible false positives, multi-theme name matches, themes with 0-1 or >15 eligible funds, missing issuer links, net-asset overrides >45 days, delisted funds, holdings (gaps, stale files, alias candidates).
- Classification reuses `method.classify` (excluded = an exclusion rule fires; no regex duplicated).
- Baseline ("last re-screen"): newest `reports/rescreen-*.universe.csv` dated before the report date, else newest `seed/universe_*.csv`. Reason: the seed holds classified funds only, so against the seed, new excluded/unclassified ETFs cannot be listed (the report says so and gives the count). From the first saved universe on, all three are listed.
- Overrides >45 days: `config/aum_overrides.yaml` already has `as_of`, so no git blame needed. Config format unchanged.
- Holdings: reads `site/data/holdings/<T>.json` per the contract. No files: "holdings not yet available". Gaps = eligible funds with no file; stale = `stale` flag or `as_of` older than 7 days; alias candidates = equity names that differ after SPEC 6.5-style normalization but are >=0.85 similar and share no identifier.
- Needs a `screen.json` from a pipeline run (statuses, eligible counts, missing links). `__main__.py` not changed.
- Sample: `reports/rescreen-2026-10-17.md` from a live run (364 funds). Matches #3's seed diff: 4 new (ACHP, CPU, GANZ, HOID), 4 delisted (ANEW, CTEX, DAT, VERS). Holdings section says not yet available.

## Verification

- `python3 -m pytest -q tests`: 32 passed, 4 subtests. (13 new in `tests/test_report.py`, via `build_report` and `load_baseline` with synthetic inputs.)
- `node --test "tests/*.test.cjs"`: 9 passed.
- Every new function has a caller.

## Deferred

- Yahoo category for possible misses: needs profile fetches for ~5,000 unclassified ETFs; misses use name cues only.
- Alias candidates untested on real holdings files (none exist yet); my similarity heuristic is not the #9 matcher.
- `.claude/commands/rescreen.md` not edited; step 2 should say to run the pipeline, then `python3 -m pipeline.report`.

## Questions for Andy

1. Possible false positives are only name cues (large cap, equal weight, dividend...). Is the list in `FALSE_POSITIVE_CUES` right?
2. Should /rescreen run the pipeline first (about 4 min) to produce `screen.json`, or should the report call it?
3. The multi-theme list is long (rule order decides). Fine as is?
