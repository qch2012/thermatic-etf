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
| `themes` | array of Theme | Themes with at least one eligible fund, in display order (SPEC 5.6, see below). |
| `no_eligible_themes` | array of NoEligibleTheme | Every other theme in `config/themes.yaml`, listed separately (SPEC 5.6), ordered by group then theme name. `themes` + `no_eligible_themes` = the whole taxonomy. |
| `funds` | array of Fund | Every classified fund (both theme lists), sorted by theme order (`themes` first, then `no_eligible_themes`), then rank (unranked last), then ticker. |
| `failed_fetches` | array of `{ticker: string, error: string}` | Funds whose fetch failed this run (they use last good data, `stale: true`). |
| `missing_issuer_links` | array of string | Tickers with no entry in `config/issuer_links.json`. |

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
| `new` | bool | Age under 0.5 years (🆕). Caveat: a fund with no price data has no `age` and gets `new: true` (method.py treats missing age as 0). Read `new` together with `status`. |
| `rank` | int or `null` | Rank within theme (1 = best). `null` unless eligible. |
| `score` | number or `null` | 0–100, within theme only. `null` unless eligible. |
| `cumulative_return`, `annualized_return`, `volatility`, `ratio` | number or `null` | SPEC 5.4, over the theme's window. `null` unless the fund is measured. |

Present when the fund has price data: `age` (years), `dollar_volume` (mean close × volume, last 63 days).

Present only when `status == "Eligible"`: `percentiles` `{size, cost, performance}` (each 0–1; 0.5 = neutral for a missing fee or unmeasured performance) and `performance_unmeasured` (bool, the † flag). Score = 100 × (0.4 × size + 0.2 × cost + 0.4 × performance); the live-weights slider can recompute from these.

Optional: `warnings` (array of string), non-fatal data-source problems.

Reserved for the holdings ticket: `top_holdings`, array of up to 3 `{name: string, weight: number}` (weight is a fraction of the fund), largest first. Absent = holdings not fetched yet; the site shows `—`.

## How the site reads it (`site/app.js`)

- 🆕 (flag and "🆕 only" filter) = `new && age != null`. A "No price data" fund has `new: true` but no `age`, so it gets no 🆕.
- `*` marker = `assets_source != "Yahoo totalAssets"`; the cell's tooltip names the source.
- Window column = the theme's `window` dates, shown only for funds with a `cumulative_return` (measured funds).
- "Hide under $50M" hides `net_assets < 50e6`; funds with `net_assets: null` stay visible (size unknown).
- Ticker links use `issuer_url` only (resolved by the pipeline from `config/issuer_links.json`; https only).
- Top 3 = `status == "Eligible"` and `rank <= 3`; All eligible = `status == "Eligible"`; All screened = every fund. Themes in `no_eligible_themes` always list all their candidates (from `funds`), under the same columns.

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
