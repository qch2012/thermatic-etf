# Site data contract: `site/data/`

Written by `python -m pipeline`. Main file: `site/data/screen.json` (all themes). Read by `site/app.js`. Other files: price files (below), plus reserved holdings and history files that later tickets write.
Numbers are JSON numbers; `null` means "no value". Dates are ISO `YYYY-MM-DD`; timestamps are ISO 8601 UTC.
Fractions are fractions (0.0035 = 0.35%), money is USD.

## Top level

| Field | Type | Meaning |
|---|---|---|
| `data_source` | string | Adapter used (`yahoo`, `stub`). |
| `synthetic` | bool | `true` for stub data. The site must label it as not market data. |
| `generated_at` | timestamp | When the pipeline wrote the file. |
| `data_as_of` | date or `null` | Latest price date across all funds (for the SPEC 6.6 stale banner). `null` only if no fund has price data. |
| `weights` | `{size, cost, performance}` | Default score weights, `{"size": 0.4, "cost": 0.2, "performance": 0.4}` (SPEC 5.5). They are a copy of the numbers hard-coded in `pipeline/method.py`; a test checks they reproduce its scores. |
| `themes` | array of Theme | Themes with at least one eligible fund, in display order (SPEC 5.6, see below). |
| `no_eligible_themes` | array of NoEligibleTheme | Every other theme in `config/themes.yaml`, listed separately (SPEC 5.6), ordered by group then theme name. `themes` + `no_eligible_themes` = the whole taxonomy. |
| `funds` | array of Fund | Every classified fund (both theme lists), sorted by theme order (`themes` first, then `no_eligible_themes`), then rank (unranked last), then ticker. |
| `failed_fetches` | array of `{ticker: string, error: string}` | Funds whose fetch failed this run. They use last good data (`stale: true`), or, with none, are published with `status: "No price data"` (see "Fund with no data"). |
| `missing_issuer_links` | array of string | Tickers with no entry in `config/issuer_links.json`. |
| `benchmark` | string or `null` | Ticker from `config/settings.yaml` `benchmark` (QQQ) whose price file `prices/<TICKER>.json` was written this run, for the momentum chart (SPEC 6.8). `null` if unset or its fetch failed. Never classified, gated or scored. Optional: older files lack it. |
| `reference` | array of `{ticker, label, trend}` | Defensive sector funds from `config/settings.yaml` `reference`, for the momentum board only (SPEC 6.8). `trend` as on Fund. Never classified, gated or scored; a fund whose fetch fails is left out. Optional: older files lack it. |

Theme order: groups in the fixed order Technology, Physical world, Social, Broad thematic (a pipeline choice; SPEC 5.6 does not order groups); inside a group, themes by `largest_net_assets` (descending), then name.

## Theme

| Field | Type | Meaning |
|---|---|---|
| `theme` | string | Theme name, as in `config/themes.yaml`. Join key to `Fund.theme`. |
| `group` | string | One of the four groups. |
| `window` | Window or `null` | Shared performance window (SPEC 5.3). `null` = performance unmeasured for the whole theme. |
| `candidates` | int | Classified funds in the theme (all gate statuses). |
| `eligible` | int | Funds with `status == "Eligible"`. Always ≥ 1. |
| `largest_net_assets` | number | Net assets of the largest eligible fund (our reading of SPEC 5.6 "largest fund"). |

Window: `{start: date, end: date, years: number (exact calendar days / 365.25), observations: int (aligned trading days)}`.

## NoEligibleTheme

| Field | Type | Meaning |
|---|---|---|
| `theme`, `group` | string | As in Theme. |
| `candidates` | array of `{ticker: string, name: string, status: string}` | Every classified fund in the theme, by ticker, with its failed gate as `status`. Empty when nothing in the directory matched the theme. Full fund records are also in `funds`. |

Example (live run 2026-10-17): `{"theme": "Hydrogen", "group": "Physical world", "candidates": [{"ticker": "HYDR", "name": "Global X Hydrogen ETF", "status": "Under $100M (established minimum)"}]}`

## Fund

Always present:

| Field | Type | Meaning |
|---|---|---|
| `ticker`, `name` | string | From the Nasdaq directory. |
| `theme`, `group` | string | Classification. |
| `first_trade_date` | date or `null` | Launch date from the data source. `null` only for a fund with no data. |
| `net_assets` | number or `null` | USD. |
| `assets_source` | string | `Yahoo totalAssets` (no marker), anything else gets the `*` fallback marker. |
| `assets_as_of` | date | Fetch date, or the override's as-of date. |
| `assets_stale` | bool | Assets from a failed fetch, or an override older than 45 days. |
| `expense_ratio` | number or `null` | Fraction. |
| `fetched_at` | timestamp or `null` | When this fund's data was last fetched successfully. `null` only for a fund with no data. |
| `stale` | bool | `true` = this run's fetch failed and last good data was reused. |
| `issuer_url` | string or `null` | Issuer fund page from `config/issuer_links.json`. Never Yahoo. `null` = show plain ticker. |
| `status` | string | `Eligible` or the first failed gate's text (SPEC 5.2). |
| `new` | bool | Age under 0.5 years (🆕). `false` when the age is unknown (a fund with no price data has no `age`). |
| `rank` | int or `null` | Rank within theme (1 = best). `null` unless eligible. |
| `score` | number or `null` | 0–100, within theme only. `null` unless eligible. |
| `cumulative_return`, `annualized_return`, `volatility`, `ratio` | number or `null` | SPEC 5.4, over the theme's window. `null` unless the fund is measured. |

Present when the fund has price data: `age` (years), `dollar_volume` (mean close × volume, last 63 days), `trend` `{1m, 3m, 6m, 1y}` (price return over the last 30, 91, 182, 365 days, measured from the last close on or before that day; `null` when the fund is younger than the period; display only, never scored).

Present only when `status == "Eligible"`: `percentiles` `{size, cost, performance}` (each 0–1; 0.5 = neutral for a missing fee or unmeasured performance) and `performance_unmeasured` (bool, the † flag). Score = 100 × (0.4 × size + 0.2 × cost + 0.4 × performance); the live-weights slider can recompute from these.

Fund with no data: a fund that failed to fetch and has no last-good data is still published, with `status: "No price data"`, `first_trade_date: null`, `fetched_at: null`, `net_assets: null`, `expense_ratio: null`, `assets_source: "Fetch failed"`, `assets_stale: true`, `assets_as_of` = today, `stale: false`, `new: false`, no `age`, and no price file. It is listed in `failed_fetches`.

Optional: `warnings` (array of string), non-fatal data-source problems.

Written by #9: `top_holdings`, array of up to 3 `{name: string, weight: number}` (weight is a fraction of the fund), largest first; derivation under "Holdings files". Absent = no holdings file; the site shows "full holdings unavailable" (never Yahoo's top 10, SPEC 4.1).

## Score and rank (for live weights, #5)

How `pipeline/method.py` computes them, so the browser can reproduce them exactly with the default weights:

- `score = 100 * (w.size * percentiles.size + w.cost * percentiles.cost + w.performance * percentiles.performance)`, computed in that order (floating point; ties depend on it).
- Rank inside a theme, eligible funds only, sorted by: `score` descending, then `net_assets` descending, then `ticker` ascending (string order). Rank 1 = first.
- Gates, windows and percentiles are fixed by the pipeline; only the weights change in the browser.

## Price files (for charts, #6)

Path: `site/data/prices/<TICKER>.json`, one per fund that has at least one adjusted close.

`{"ticker": string, "dates": [date, ...], "adjusted_close": [number, ...]}`

- Same length, oldest first. Only days with an adjusted close (days where it is missing are left out).
- Coverage: the last 3 calendar years up to the fund's own last adjusted close (Feb 29 falls back to Feb 28), or back to the theme's `window.start` if that is earlier (a stale peer pulls the window end back). Younger funds have shorter files.
- Written atomically (temp file then rename), only when the run publishes (after the 90% check). Funds with stale data get their files rewritten from the last good data. Each run deletes the price files of tickers not in its `funds`.
- Theme charts rebase to the theme's `window.start` using these files.

## Holdings files (reserved, written by #9)

Path: `site/data/holdings/<TICKER>.json`, one per fund with a working issuer holdings source (SPEC 4.1). No file = "full holdings unavailable".

```json
{"ticker": "NATO", "as_of": "2026-10-16", "fetched_at": "2026-10-17T22:40:00+00:00", "stale": false,
 "source": "https://issuer.example/nato/holdings.csv",
 "holdings": [{"name": "Airbus SE", "ticker": "AIR", "isin": "NL0000235190", "asset_type": "Equity", "weight": 0.081}]}
```

- `as_of`: the issuer file's own date. `source`: the URL it came from (`config/holdings_sources.yaml`). `stale`: last good file reused after a failed fetch.
- Each holding: `name` (string), `ticker` (string or `null`), optional `isin`, `cusip`, `sedol` (only when the issuer gives them), optional `location` (issuer country as published, e.g. `"France"`; used in company matching), `asset_type` (string as published), `weight` (fraction of net assets, as published, not rescaled).
- Every published row is kept, including cash and derivatives. The overlap code drops non-equity rows (SPEC 4.1).
- `company` (added by #9): string or `null`. The pipeline's company key (SPEC 6.5 matching across all holdings files of the run). Rows with the same key are one company in every fund. `null` = non-equity row (`asset_type` is not `Equity`), left out of overlap and `top_holdings`. `site/overlap.js` sums by this key and does no matching of its own.
- Holdings failures never block publishing (SPEC 4.1): a fund whose fetch fails reuses its last good file (`stale: true`) or gets none; if the holdings step fails as a whole, `screen.json` is published with no `top_holdings`.
- Written for eligible funds with a source only. Parsers and fetch: `pipeline/sources/issuers/` (`PARSERS`, one module per issuer format). Matching and top 3: `pipeline/holdings.py`.
- `Fund.top_holdings` in `screen.json` = the 3 largest equity companies by weight, after summing rows of the same company with the SPEC 6.5 matching (identifier, normalized name with a compatible `location`, `config/holding_aliases.yaml` aliases; `never_merge` names match only their exact spelling). Each entry: `{name, weight}`. Absent when the fund has no holdings file.

## History snapshots (reserved, written by #8 / #7)

Path: `site/data/history/<YYYY-MM-DD>.json`, one per published run, named by the run's UTC date (`generated_at[:10]`). A rerun on the same day overwrites it. `site/data/history/index.json` lists the available dates, oldest first: `["2026-10-17", ...]` (a static site can't list a folder).

Snapshot shape (compact, no indentation): `{"date": "2026-10-17", "funds": {"MJ": ["Cannabis", 2, 60.0, 104143576], ...}}`

- One entry per fund in `screen.json`: `[theme, rank, score, net_assets]` (SPEC 6.4). `rank` and `score` are `null` unless eligible. Score rounded to 2 decimals, net assets to whole dollars.

## Method panel (#12)

The Method panel takes gate thresholds, window rules and weights from the SPEC 5 wording, not from this JSON. This file carries results, not rules (the one exception is `weights`, for the sliders).

## How the site reads it (`site/app.js`)

- 🆕 (flag and "🆕 only" filter) = `new && age != null`. A "No price data" fund has `new: false` and no `age`, so it gets no 🆕.
- `*` marker = `assets_source != "Yahoo totalAssets"`; the cell's tooltip names the source.
- Window column = the theme's `window` dates, shown only for funds with a `cumulative_return` (measured funds).
- "Hide under $50M" hides `net_assets < 50e6` and funds with `net_assets: null` (size unknown; Andy, 2026-10-17).
- Ticker links use `issuer_url` only (resolved by the pipeline from `config/issuer_links.json`; https only; an unparsable URL shows the plain ticker).
- Top 3 = `status == "Eligible"` and live rank <= N (N = 3 by default, set by the top-N slider); All eligible = `status == "Eligible"`; All screened = every fund. Rank and score shown are recomputed in the browser from `percentiles` and the slider weights (equal to `rank`/`score` at the default weights). Themes in `no_eligible_themes`: Top 3 lists theme names only, with a count; All eligible and All screened list all their candidates (from `funds`), under the same columns.

## Example fund

From the live Yahoo run on 2026-10-17 (abridged top level):

```json
{
  "data_source": "yahoo",
  "synthetic": false,
  "generated_at": "2026-10-17T22:48:31.365556+00:00",
  "data_as_of": "2026-10-16",
  "weights": {"size": 0.4, "cost": 0.2, "performance": 0.4},
  "themes": [
    {
      "theme": "Cannabis",
      "group": "Social",
      "window": {
        "start": "2023-10-16",
        "end": "2026-10-16",
        "years": 3.0006844626967832,
        "observations": 754
      },
      "candidates": 5,
      "eligible": 2,
      "largest_net_assets": 895766464
    },
    "..."
  ],
  "funds": [
    {
      "ticker": "MJ",
      "name": "Amplify Alternative Harvest ETF",
      "theme": "Cannabis",
      "group": "Social",
      "first_trade_date": "2015-12-03",
      "net_assets": 104143576,
      "expense_ratio": 0.0075,
      "assets_source": "Yahoo totalAssets",
      "warnings": [],
      "fetched_at": "2026-10-17T22:46:58.317313+00:00",
      "stale": false,
      "issuer_url": "https://amplifyetfs.com/mj",
      "assets_as_of": "2026-10-17",
      "assets_stale": false,
      "age": 10.869267624914443,
      "dollar_volume": 839708.5995598445,
      "status": "Eligible",
      "cumulative_return": -0.37102208493277034,
      "annualized_return": -0.14317175165784102,
      "volatility": 0.628886710666974,
      "ratio": -0.22765905087420013,
      "rank": 2,
      "score": 60.00000000000001,
      "new": false,
      "percentiles": {
        "size": 0.5,
        "cost": 1.0,
        "performance": 0.5
      },
      "performance_unmeasured": false
    },
    "..."
  ],
  "failed_fetches": [],
  "missing_issuer_links": [
    "..."
  ]
}
```

## stocks.json (SPEC 6.9)

`site/data/stocks.json`, written with screen.json when this run has holdings files. Display only.

| Field | Type | Meaning |
|---|---|---|
| `generated_at` | string | Same as screen.json. |
| `holdings_as_of` | `[date, date]` | Oldest and newest `as_of` among the holdings files used. |
| `stocks` | array | Stocks held at ≥ 1% by eligible, non-Broad-thematic funds in 2+ themes, most themes first. Each: `name`, `ticker` (US symbol when matched, else the fund's), `country` (or `null`), `direct` (bool), `listing` (why direct or not), `themes` (sorted names), `avg_weight`, `funds` (`{ticker, theme, weight}`, largest weight first). |
