# Thematic ETF Screener

All-theme screen (issues #2–#3). Read `SPEC.md` for the full project; this is not the complete screener or a private deployment.

## Run locally

Python 3.12+:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m pipeline
```

The pipeline pulls the Nasdaq ETF directory, classifies names using unchanged `config/themes.yaml`, fetches only the selected theme, applies SPEC §5 gates/windows/scores, and atomically writes `site/data/screen.json`. Default theme: Semiconductors.

```sh
.venv/bin/python -m http.server 8000 --bind 127.0.0.1 --directory site
```

Open http://localhost:8000. The bare table defaults to the top three eligible funds; select “Show all screened funds” for failure reasons. No external scripts, fonts, or trackers.

## Switch sources

Change `data_source: yahoo` to `data_source: stub` in `config/settings.yaml`, then run the same command. The stub generates deterministic synthetic prices/profiles; the Nasdaq directory is still fetched live and the site prominently labels synthetic output. No pipeline or site code changes are required.

For fully offline tests, pass a saved Nasdaq-format directory:

```sh
.venv/bin/python -m pipeline --directory /path/to/nasdaqtraded.txt
```

`--settings` and `--output` accept alternative paths. Adapters live exclusively in `pipeline/sources/` and implement `history(ticker)` and `profile(ticker)`; the contract is in `pipeline/sources/__init__.py`. Yahoo reuses a cookie session, throttles every request to ~3.3/s, and retries 429/5xx and network errors with exponential backoff.

Per-source last-good data is cached in `.cache/`. Fetch failures reuse cached data and are marked stale. An uncached failure, fewer than 90% successful fetches, no classified funds, or invalid JSON numbers aborts without overwriting the previous output. Net assets fall back to Yahoo quote `netAssets`, then configured issuer overrides, with source/date markers. If only the optional Yahoo quote fallback fails, successful history/profile fields remain usable and issuer overrides are still applied; the error is logged and retained in the fund's JSON `warnings`. Missing adjusted closes do not remove valid close/volume days from liquidity or age calculations; performance uses only dates with adjusted prices. Every theme in `config/themes.yaml` is screened into one `site/data/screen.json`; its shape is in `docs/contract.md`. Generated output and caches are ignored for now; daily JSON commits belong to the later refresh job.

## Tests

```sh
.venv/bin/python -m unittest discover -s tests -v
node --test "tests/*.test.cjs"
```

Node 18+ is needed only for the dependency-free static-page tests. Tests use synthetic data and do not require network access. The seed regression preserves and explicitly records two existing config conflicts; see `reports/issue-2.md` for questions and live-run results.

## Not implemented in this tracer

Full holdings/overlap, charts, ranking history, live weights, daily Actions, schema validation, automatic failure issues, and Cloudflare Pages/Access setup remain later stages. Do not publish this as a private site until Access protects production and preview domains. Re-screens remain config-only and require review before merging.
