# Issue #3: full screening method plus method tests

Branch: `feat/3-full-method` (based on `feat/2-theme-tracer`). Not merged, not pushed.

## Delivered

- `python -m pipeline` now screens **every theme** in `config/themes.yaml` in one run. Each theme goes through the existing SPEC §5 code (`pipeline/method.py`, unchanged): gates, shared window, metrics, within-theme percentiles, score, rank with net-asset tie-break.
- Themes are ordered per §5.6: groups Technology → Physical world → Social → Broad thematic; inside a group, by largest eligible fund's net assets; themes with no eligible fund last.
- `config/settings.yaml`: the `theme` key is gone (only `data_source` remains). Reason: the pipeline no longer runs one theme.
- `site/data/screen.json` shape changed: top-level `themes` (per-theme window and counts) plus a flat `funds` list where every fund carries `theme` and `group`. Documented in `docs/contract.md` with a real example fund.
- `site/app.js`: minimal change. One heading row per theme (group, theme, window or "performance unmeasured", "no eligible fund" when relevant), then its funds. Top 3 / all toggle unchanged.
- Tests added: a hand-computed window test (literal expected values, no recomputation), a classifier test on today's live directory names, and real fund names for the known cases.
- `tests/index.js` (one line) so `node --test tests/` works. Without it Node 24 treats `tests/` as a module path and fails.

Not changed: SPEC.md, `config/themes.yaml`, scoring rules.

## Acceptance criteria

| Criterion | Where |
|---|---|
| Window alignment (intersection, no pre-start prices) | `test_hand_computed_window` (B skips a day → 260 not 261 observations; A's 2023 prices at 50 would give 300% instead of 100%), `test_alignment_metrics_and_young_fund` |
| Exact elapsed days | `test_hand_computed_window`: `years == 364 / 365.25` |
| Annualization | `test_hand_computed_window`: `2 ** (365.25/364) - 1` |
| ddof=1 vol | `test_hand_computed_window`: 258 zero returns + ln 2, divided by n − 1 = 258 |
| Percentile ties | `test_percentile_ties`, all-tie case scoring 75 in `test_hand_computed_window` |
| Neutral 0.5 missing fee / unmeasured perf | `test_three_year_cap_sole_fund_and_missing_fee`, `test_short_window_and_no_measured_funds`, `test_alignment_metrics_and_young_fund` |
| Sole fund = 100 with known fee | `test_three_year_cap_sole_fund_and_missing_fee` |
| Classifier reproduces seed on today's directory | `test_classifier_reproduces_seed_on_live_directory` (fixture `tests/fixtures/nasdaqtraded_2026-10-17_seed_tickers.txt`); diff below |
| LAZR, MJ, Blue Chip, 2x | `test_classifier_baseline_and_known_cases` with real names: LAZR "Tema Photonics & Optical ETF", MJ "Amplify Alternative Harvest ETF", FBCG "Fidelity Blue Chip Growth ETF", TSXU "Direxion Daily Semiconductors Top 5 Bull 2X ETF" |
| Per-fund failure reuses last good data, marked stale | `test_last_good_data_at_ninety_percent` (from #2, now over the all-theme run) |

## Verification

- `python3 -m pytest -q tests` → 19 passed, 4 subtests passed.
- `node --test tests/` → 2 passed, 0 failed.
- `node --check site/app.js` → ok.
- Stub run over today's full directory: `python3 -m pipeline --settings <stub settings> --directory <saved directory>` → 364 funds, about 1 s.
- **Live Yahoo run** (`python3 -m pipeline`, 2026-10-17): succeeded in 4 min 9 s. 44 themes, 364 funds, 0 failed fetches, 0 warnings. Status counts: Eligible 171, Under $25M 88, Under $100M 72, Under $0.5M volume 28, No net-asset data 5.
  - Themes with no eligible fund: Electronic components (MLCC, PCB, power semis); Hydrogen; Aging & longevity; GLP-1, obesity & heart health; Next-gen consumer; Sports betting & prediction markets.
  - Themes with performance unmeasured (every eligible fund is under 0.5 years): Photonics & optics (EUV, LYTE, FOTO, LAZR), Neocloud & AI compute (NCLD).
  - Known cases on live data: LAZR → Photonics & optics, eligible, rank 4. MJ → Cannabis, eligible, rank 2.
  - 267 classified funds have no issuer link and show as plain tickers.

## Seed diff (today's directory vs `seed/universe_2026-10-06.csv`)

Every seed ticker still listed gets its seed theme: **0 differences**.

- **WDEF and ARKW are resolved by today's names.** The live directory calls WDEF "WisdomTree Europe Defense Fund" (matches Aerospace & defense) and ARKW "ARK Next Generation Internet ETF" (matches Internet before the gene rule). The seed file had "WisdomTree Trust" and "ARK Next Generation Technology ETF". The seed-name test still records both as known mismatches.
- **Delisted (in seed, not in today's directory):** ANEW, CTEX, DAT, VERS (all ProShares).
- **New today (classified, not in seed):** ACHP (Global X Asia Semiconductor) and CPU (Amplify Top 10 Semiconductors) → Semiconductors; GANZ (Tuttle Capital Thematic) → Disruptive innovation & multi-theme; HOID (Tuttle - Rareview Humanoid Robotics) → Humanoid robotics & physical AI. Total classified is still 364.

## Deferred

- §7 check "no theme loses all its eligible funds only because of fetch errors": not built (not in this ticket). The 90% check is global, not per theme.
- Schema validation, holdings/overlap, charts, live weights, history, Method panel, workflow: later tickets.
- `largest_net_assets` uses the largest *eligible* fund. §5.6 says "largest fund". I read that as eligible, since themes without eligible funds are listed separately.

## Questions for Andy

1. **WDEF / ARKW:** both now classify correctly from live names. Do you still want overrides as a guard in case the names change back, or is no change fine?
2. **An uncached fetch failure stops the whole publish** (kept from #2: "never silently drop a fund"). With all 364 funds in one run, one new fund that Yahoo can't serve on its first day blocks every theme. Should such a fund instead be published with status `No price data` and listed in `failed_fetches`?
3. **GANZ** ("Tuttle Capital Thematic ETF") lands in Disruptive innovation & multi-theme only because its name contains "thematic". Is that the right home?
