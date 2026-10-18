# Issue #10: holdings parsers for the remaining issuers

Branch `feat/10-more-parsers` (on `integrate/wave-b` @ c7d46b0). Not merged, not pushed.

## Delivered (parsers in `pipeline/sources/issuers/`, sources in `config/holdings_sources.yaml`)

| Parser | Format | Funds |
|---|---|---|
| themes | Themes CSV (NATO, BOTT) | 2 |
| select | Select Funds JSON (EUAD, HBMX, FOTO) | 3 |
| globalx | CSV, URL has the date | 18 |
| invesco | JSON API by CUSIP | 13 |
| firsttrust | HTML table | 15 |
| ark | CSV | 6 |
| tema | CSV, URL has the date | 6 |
| roundhill | one shared daily CSV, picked by `account` | 7 |
| defiance | HTML table | 4 |
| sprott | CSV embedded in the page | 6 |
| vaneck | xlsx (stdlib reader `xlsx.py`) | 4 |
| ssga | xlsx | 8 |
| ishares (14 existing, 6 added; MADE is not eligible) | CSV | 20 |

Shared pieces: `ids.py` (`identifiers`: CUSIP/CINS and SEDOL check digits, so `-`, `CASHEUR`, `X9USDGSFT`, `BREADUMMY` are never emitted as identifiers), `dates.py` (previous business day), dated-URL fetch (`{date}`/`{mdy}`, walks back up to 6 days, skips soft-404 pages), `Session.get(url, raw=True)` for xlsx (one-line change in `pipeline/sources/http.py`), and `config/holdings_missing.yaml` plus a 2-line change in `pipeline/report.py` so the report's "Eligible funds without a holdings file" list shows each reason.

As-of rule: Themes, Roundhill and Defiance date a file with the next trade date, so as_of is the previous business day (NATO file dated Mon 10/19 gives 10/16). Others use the date in the file.

## Coverage

Live run 2026-10-17/18 (`python3 -m pipeline`): **111 of 171 eligible funds have full holdings** (was 13 before #10). 0 stale, 0 holdings warnings. 60 are listed as missing with a reason in `config/holdings_missing.yaml`:
- 403 to scripts, not worked around: Amplify (7: HACK BLOK IPAY BATT MJ AIVC IBUY), KraneShares (4), WisdomTree (5).
- VanEck ESPO NLR REMX SMHX RACK WARP NODE: xlsx URL returns the web page, not a file.
- Xtrackers CHPS XAIX: holdings loaded by JavaScript.
- Fidelity FCLD FDTX FDIG: fund page is a JavaScript app, not attempted.
- Remaining ~33 (single-fund issuers such as Kurv, Pacer, Bitwise, Corgi, REX, Range, FlexShares, AB, plus VistaShares, ALPS, Procure, etc.): not attempted, timeboxed. Each reason says so.

## NATO vs EUAD (deferred #9 criterion)

Live files: NATO as of 2026-10-16, EUAD as of 2026-10-15. **Overlap 33.9% over 19 companies.** Shared include Airbus 6.63% (both "AIRBUS GROUP SE"), BAE Systems 4.15% (NATO local line vs EUAD ADR), Rolls-Royce 7.60%, Safran 6.24%, Rheinmetall 2.99%, Leonardo 1.19% (via the #9 alias). No new alias was needed. (Not checked in the browser this session; computed from the published holdings files.)

## Verification

- `python3 -m pytest -q tests`: 80 passed, 4 subtests. `node --test "tests/*.test.cjs"`: 45 passed. Offline.
- Every parser has a test against a real downloaded fixture in `tests/fixtures/`. Each source URL was fetched live through `Session` and checked: weights sum to 1.00 (+-0.002), no negative equity weights.
- Audit: placeholders (all parsers use `identifiers`, or emit none); percent to fraction (checked per format, sums are 1.0; Tema is already a fraction); non-equity rows (cash, futures `NQZ6 Index`, swaps, T-bills, money market, CVRs and private funds without ids get a non-Equity `asset_type`). Every new function has a caller (parsers via `PARSERS`, `xlsx_rows` via vaneck/ssga, `previous_business_day` via themes/roundhill/defiance).
- Commits: parser code for First Trust, ARK, Invesco, Sprott and State Street landed in earlier commits (Global X, Defiance, VanEck) and was wired to config in its own commit, so "one commit per issuer" is by config wiring, not strictly by code. The live run's `site/data` output is left uncommitted.

## Questions for Andy

1. **Swaps.** Roundhill funds hold big total return swaps on named stocks (DRAM about 41%, LYTE 36%, NCLD 43%, plus DISK/Tema). They are non-equity rows, so they are left out of overlap and top 3, which understates those funds' exposure. Count swaps on a named company as that company?
2. **ETFs inside ARK funds** (e.g. 3IQ Ether Staking ETF) are treated as Equity. OK?
3. **VanEck names are cut at 40 characters** and VanEck gives only FIGI, so matching is by name only; truncated names may miss matches.
4. **ARKW's file is dated 2026-10-06** at the source (others 10-16). I could not find a newer file name; the report will flag it as stale by age.
5. **ARK, Global X, Tema and others are the issuer's own file names**, which may change when funds are renamed (ARKX and ARKF already did). A failed fetch keeps the last good file, marked stale.
6. **Issuer links.** The 39 funds added without an `issuer_links.json` entry still have none. Add them in the next re-screen?
7. No aliases were added.
