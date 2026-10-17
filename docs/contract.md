# Site data contract: `site/data/screen.json`

Written by `python -m pipeline` (one file, all themes). Read by `site/app.js`.
Numbers are JSON numbers; `null` means "no value". Dates are ISO `YYYY-MM-DD`; timestamps are ISO 8601 UTC.
Fractions are fractions (0.0035 = 0.35%), money is USD.

## Top level

| Field | Type | Meaning |
|---|---|---|
| `data_source` | string | Adapter used (`yahoo`, `stub`). |
| `synthetic` | bool | `true` for stub data. The site must label it as not market data. |
| `generated_at` | timestamp | When the pipeline wrote the file. |
| `themes` | array of Theme | Every theme in `config/themes.yaml`, in display order (SPEC 5.6, see below). |
| `funds` | array of Fund | Every classified fund, sorted by theme order, then rank (unranked last), then ticker. |
| `failed_fetches` | array of `{ticker: string, error: string}` | Funds whose fetch failed this run (they use last good data, `stale: true`). |
| `missing_issuer_links` | array of string | Tickers with no entry in `config/issuer_links.json`. |

Theme order: groups in the fixed order Technology, Physical world, Social, Broad thematic; inside a group, themes by `largest_net_assets` (descending); themes with no eligible fund come last in their group, alphabetically.

## Theme

| Field | Type | Meaning |
|---|---|---|
| `theme` | string | Theme name, as in `config/themes.yaml`. Join key to `Fund.theme`. |
| `group` | string | One of the four groups. |
| `window` | Window or `null` | Shared performance window (SPEC 5.3). `null` = performance unmeasured for the whole theme. |
| `candidates` | int | Classified funds in the theme (all gate statuses). |
| `eligible` | int | Funds with `status == "Eligible"`. `0` = list the theme separately with its candidates. |
| `largest_net_assets` | number or `null` | Net assets of the largest eligible fund; `null` when `eligible == 0`. |

Window: `{start: date, end: date, years: number (exact calendar days / 365.25), observations: int (aligned trading days)}`.

## Fund

Always present:

| Field | Type | Meaning |
|---|---|---|
| `ticker`, `name` | string | From the Nasdaq directory. |
| `theme`, `group` | string | Classification. |
| `first_trade_date` | date | Launch date from the data source. |
| `net_assets` | number or `null` | USD. |
| `assets_source` | string | `Yahoo totalAssets` (no marker), anything else gets the `*` fallback marker. |
| `assets_as_of` | date | Fetch date, or the override's as-of date. |
| `assets_stale` | bool | Assets from a failed fetch, or an override older than 45 days. |
| `expense_ratio` | number or `null` | Fraction. |
| `fetched_at` | timestamp | When this fund's data was last fetched successfully. |
| `stale` | bool | `true` = this run's fetch failed and last good data was reused. |
| `issuer_url` | string or `null` | Issuer fund page from `config/issuer_links.json`. Never Yahoo. `null` = show plain ticker. |
| `status` | string | `Eligible` or the first failed gate's text (SPEC 5.2). |
| `new` | bool | Age under 0.5 years (🆕). |
| `rank` | int or `null` | Rank within theme (1 = best). `null` unless eligible. |
| `score` | number or `null` | 0–100, within theme only. `null` unless eligible. |
| `cumulative_return`, `annualized_return`, `volatility`, `ratio` | number or `null` | SPEC 5.4, over the theme's window. `null` unless the fund is measured. |

Present when the fund has price data: `age` (years), `dollar_volume` (mean close × volume, last 63 days).

Present only when `status == "Eligible"`: `percentiles` `{size, cost, performance}` (each 0–1; 0.5 = neutral for a missing fee or unmeasured performance) and `performance_unmeasured` (bool, the † flag). Score = 100 × (0.4 × size + 0.2 × cost + 0.4 × performance); the live-weights slider can recompute from these.

Optional: `warnings` (array of string), non-fatal data-source problems.

## Example fund

From the live Yahoo run on 2026-10-17 (abridged top level):

```json
{
  "data_source": "yahoo",
  "synthetic": false,
  "generated_at": "2026-10-17T22:48:31.365556+00:00",
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
