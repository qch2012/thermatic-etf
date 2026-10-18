# Issue #9: issuer holdings and overlap, first issuer

Branch: `feat/9-holdings` (on top of `feat/4-main-screen` @ 5320b89). Not merged, not pushed.

## Delivered

- `pipeline/sources/issuers/` (SPEC §2/§4.1 location): parsers and fetch.
  - `ishares.py` `parse_ishares`: reads the iShares `latest-holdings.csv` in the common shape: `as_of` plus rows of `name`, `ticker`, `asset_type`, `weight` and `location` (the issuer's country). Weights are fractions, kept as published and not rescaled. It handles the three column layouts seen live: plain, with a `Type` column, and `Market Weight` / `Notional Weight` (IFRA).
  - `__init__.py`: `PARSERS` (parser name → function) and `fetch(source, get)`. `get` is `pipeline/sources/http.Session().get`, which already throttles to ≤3.3 req/s, retries with backoff on 429/5xx and sends a User-Agent. This is a generic HTTP helper, not a Yahoo call. Nothing falls back to Yahoo.
- `pipeline/holdings.py`: matching, top 3 and writing.
  - `normalize` and `match_companies`: SPEC 6.5 company matching across every holdings file in the run. Two rows are one company if:
    - they share an identifier (ISIN, CUSIP or SEDOL), or
    - they are listed together under `aliases` in `config/holding_aliases.yaml`, or
    - they have the same normalized name and a compatible country: the same country, or one row has no country and that name appears with only one country in the run.

    Names listed under `never_merge` match only their exact spelling. Each equity row gets a `company` key. Non-equity rows get `null`.
  - `top_holdings`: the 3 largest equity companies, with listings and share classes of one company summed first.
  - `refresh` / `fill_holdings`: fetch eligible funds that have a source, write `site/data/holdings/<TICKER>.json`, and set `Fund.top_holdings`. A failed fetch or parse reuses the last good file marked `stale: true`. A last good file that is unreadable or has no holdings is skipped with a warning. With no usable last good file the fund gets no holdings.
- `config/holdings_sources.yaml`: the 14 iShares funds in `issuer_links.json`. Each URL is the fund page's own "latest holdings CSV" link.
- `config/holding_aliases.yaml`: `aliases` has one entry, Leonardo SpA = Leonardo-Finmeccanica SpA. Reason: NATO's file still uses the pre-2017 name. `never_merge` is empty.
- `pipeline/__main__.py`: one import plus a guarded call wrapped in try/except. Any holdings error is logged and `screen.json` is published without `top_holdings` (SPEC 4.1). Stub runs skip holdings, so synthetic screens get no real holdings and tests stay offline.

### Review fixes (second commit)

1. **False name merges.** "Siemens AG" (Germany) and "Siemens Ltd" (India) both normalize to `siemens`.
   - Fix: a name match now also needs a compatible country. Parsers emit `location`.
   - A row with no country joins its name only when that name has one country in the run. If it has two or more, the row stays apart, because guessing could join two companies.
   - `never_merge` covers rows with no country data.
   - Good merges are kept and tested: Alphabet A/C (different ISINs, same country), TSMC ADR vs local (same country), Saab AB vs "SAAB B" (a trailing share-class letter is now dropped), and the BAE London listing vs the ADR (EUAD has no country).
   - On the 13 live iShares files, no name appears with two countries, so no live merge changed.
2. **Holdings never block publishing.** The `__main__.py` call is wrapped in try/except. Tested with a bad `holdings_sources.yaml` through `run()`, and with an unparsable last good file and one with no holdings.
3. **Parsers moved** to `pipeline/sources/issuers/` (SPEC §2, §4.1). Matching and top 3 are in `pipeline/holdings.py`. Imports, tests and the contract are updated.
4. **Airbus naming.** Both live files say "AIRBUS GROUP SE" today (NATO file dated 2026-10-19, EUAD 2026-10-15), so they match by name. Airbus has been called "Airbus SE" since 2017. If either file switches, `normalize` gives `airbus` vs `airbus group` and they would no longer match. **#10:** add an alias `["Airbus SE", "Airbus Group SE"]` if a file uses the new name (or add it now; Andy's call).
- `site/overlap.js` (new) plus a mount point and script tag in `site/index.html`:
  - Theme matrix of eligible funds, with each fund's as-of date and "full holdings unavailable" where there is no file.
  - Two-fund picker across themes, with overlap %, shared-company table and as-of dates.
  - Pairs at 30% or more are highlighted (`.high`, one line in `style.css`). Pairs with dates more than 7 days apart get ⚠ plus the day count.
  - Holdings files load lazily. Overlap sums by the pipeline's `company` key, so the matching logic exists only in Python.
- `site/app.js`: the Top 3 holdings cell shows "full holdings unavailable" instead of `—` (1 line).
- `docs/contract.md`: the holdings sections I own are filled in. See contract changes below.
- Fixtures: real iShares files for IDEF, ITA and IFRA (downloaded 2026-10-17, as of 2026-10-15), one per column layout.

### Contract vs criterion on non-equity rows

There is no real conflict. I kept the contract file shape: every published row, cash and futures included, each with `asset_type`. Non-equity rows (`asset_type` not `Equity`) get `company: null`, so matching, `top_holdings` and overlap all leave them out. That matches the criterion's "dropped".

## Issuer chosen and why

NATO and EUAD come from different issuers, and neither format covers the other fund:
- NATO: Themes ETFs, `https://themesetfs.com/storage/holdings/Holdings-NATO.csv`. CSV with `stock_ticker, cusip` (a SEDOL for foreign rows), `security_name`, `weightings` (%) and `date`. It holds local listings (`AIR FP`, `BA/ LN`).
- EUAD: Tuttle Capital / Select Funds. JSON at `https://jdkfnvgkfwotjlyovbrk.supabase.co/functions/v1/fund-public-api?ticker=EUAD&view=all` (the API behind select-funds.com/fund-info), under `holdings[]`: `security_name`, `security_ticker`, `security_id` (CUSIP/CINS), `weight` (%), `as_of_date`. It holds ADRs (EADSY, BAESY). The Google-Sheets CSVs linked on that page are stale (May and Nov 2025).

Neither fund is in `config/issuer_links.json`. Each format covers one eligible fund (Themes also runs BOTT). So per the brief I chose **iShares**, the issuer with the most eligible funds (13 of 171).

**NATO vs EUAD criterion:** the matching is done and tested on real rows from both files. "AIRBUS GROUP SE" in both files, and "BAE Systems PLC" (NATO) vs "BAE SYSTEMS PLC -SPON ADR" (EUAD), get the same company key. The JS test checks that the overlap includes Airbus and BAE. What's still needed is two small parsers (Themes CSV and Select JSON) plus two `holdings_sources.yaml` entries. That is #10.

## Verification

- `python3 -m pytest -q tests` → 34 passed, 4 subtests passed (14 in `tests/test_holdings.py`). Offline.
- `node --test "tests/*.test.cjs"` → 12 passed (2 new in `tests/overlap.test.cjs`, 1 new in `tests/site.test.cjs`). Offline.
- After the review fixes: re-ran the holdings step live on the 13 iShares funds. Every equity row has a country, and no normalized name appears with two countries, so the new location rule changed no live merges.
- Live run: `python3 -m pipeline` (Yahoo plus iShares) published 364 funds. 12 of the 13 eligible iShares funds got holdings. IFRA failed because of a new column layout, was logged, and did not block publishing. I added that layout (test first) and re-ran only the holdings step on that screen.json: all 13 now have files and `top_holdings`.
- Browser (Chrome, `python3 -m http.server -d site`): the overlap section renders with no console errors. Aerospace & defense matrix: ITA vs IDEF = 28.7% (34 shared companies), and the other 8 funds show "full holdings unavailable". Picker SOXX vs ARTY = 29.8%. No live pair reached 30%, so the highlight was checked only in code and unit tests. The main table shows "full holdings unavailable" in 99 rows. 390 px width was not checked.

## Deferred

- Parsers for every other issuer (list below), including Themes (NATO) and Select (EUAD).
- Holdings sources for eligible iShares funds without an issuer link (IGF, IHAK): their product page URLs aren't in config.
- No re-screen report lines yet for "eligible without holdings source", "holdings older than 7 days" or "names that look alike but didn't match" (#11). The pipeline logs funds without holdings at INFO level.
- MADE has a source but is not eligible, so it isn't fetched (SPEC 4.1: eligible funds only).

## Issuers still needing parsers (input for #10)

Eligible funds without holdings, by issuer link (live run 2026-10-17):

| Issuer | Eligible funds |
|---|---|
| Global X | BOTZ CLOU DTCR FINX SNSR DRIV PAVE COPX URA LIT |
| Invesco | SOXQ IGPT PNQI KNCT PPA PHO CGW TAN PBE |
| First Trust | CIBR FDN SKYY NXTG GRID AIRR QCLN FIW FAN |
| VanEck | SMH IBOT DAPP ESPO NLR REMX MOO |
| Roundhill | DRAM LYTE HUMN METV NCLD |
| Amplify | HACK BLOK IPAY BATT MJ |
| ARK | ARKW ARKQ ARKX ARKF ARKG |
| Tema | DISK VOLT WELD CANC |
| State Street | FITE ROKT CNRG XHE |
| Defiance | QTUM UFOX JEDI AIPO |
| Sprott | COPJ SETM REXC |
| VistaShares | AIS POW |
| Fidelity | FCLD FDTX |
| Themes ETFs | BOTT, plus NATO (format checked, see above) |
| Select / Tuttle | EUAD (format checked, see above) |
| One fund each | KMEM (Kurv), WQTM (WisdomTree), SRVR (Pacer), BITQ, EUV (Corgi), FOTO, KOID (KraneShares), DRNZ (REX), NFRA (FlexShares), NUKZ (Range), MSOS (AdvisorShares), FWD (AllianceBernstein) |
| No issuer link (76 eligible) | includes NATO, EUAD, XAR, SHLD, IGF, IHAK, ARKK, KWEB and others; see `missing_issuer_links` in screen.json |

### Notes for #10 parsers

- Emit `location` (country) where the file has one. NATO has `country_full`. EUAD has `country`, but it is null today. Without it, same-name companies in different countries can only be kept apart by `never_merge`.
- NATO's `cusip` column holds a CUSIP for US rows and a 7-character SEDOL for foreign rows. Map each one to the right field, or identifier matching will mislabel them.
- Never emit placeholder identifiers such as `-` or `CASHEUR` as `isin`/`cusip`/`sedol`. Matching treats any non-empty value as a real identifier.
- NATO's file is dated 2026-10-19 on 2026-10-17 (it gives the next trade date). Decide which date to show as `as_of`.
- Airbus naming (see review fix 4): add an alias if either file switches to "Airbus SE".

## Questions for Andy

1. **Leonardo alias.** I added "Leonardo SpA" = "Leonardo-Finmeccanica SpA" (same company, renamed in 2017). Keep it?
2. **Same name, different companies.** "Siemens AG" (Germany) and "Siemens Ltd" (India, a separately listed subsidiary) both normalize to "siemens".
   - Rule now: a name match also needs the same country. A row with no country joins its name only if that name has one country in the run.
   - Names under `never_merge` in `holding_aliases.yaml` match only their exact spelling. It is empty for now.
   - Is that the right reading of SPEC 6.5? Should Siemens AG / Siemens Ltd go into `never_merge` now, for files without country data?
   - Side effect: an ADR file that gives "United States" as the ADR's country would no longer join the local listing by name. It would need an identifier or an alias. iShares gives the home country, so nothing changed in today's data.
3. **IDRV issuer link** (`https://www.ishares.com/us/products/307332/`) has no page slug and returned 403 to scripts. The holdings source uses the full URL. Should `issuer_links.json` get the full URL?
4. **NATO and EUAD have no issuer links**, although both are eligible. Add them (themesetfs.com/etfs/nato, select-funds.com/fund-info) in the next re-screen?
5. **"full holdings unavailable" in the main table.** It now shows in about 158 of 171 eligible rows until more parsers land. The criterion asks for it, but it's noisy. Keep it, or use `—` there and the full text only in the overlap view?
