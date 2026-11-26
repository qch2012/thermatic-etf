# Thematic ETF Screener — Build Spec

Spec version 1.1 · 2026-10-07 (1.1: overlap uses full issuer holdings instead of Yahoo top 10)
Builder: Claude Code, working in this repo.

## 1. Goal

A website that shows the thematic ETF screen (currently on the Notion page "Thermatic ETF"). It must:

1. Refresh market data and scores automatically every US trading day.
2. Let an AI agent (Claude Code) re-screen on request: find new ETF launches, fix theme rules and update config.
3. Be interactive: sort/filter, live score weights, price charts, ranking history, and holdings overlap.
4. Be free to host. The site is public (GitHub Pages; user approved, 2026-10-28).

The website replaces the Notion page. The Notion page will only link to it.

## 2. Architecture

```
                 daily cron (GitHub Actions)
nasdaqtraded.txt ──┐
Yahoo Finance  ────┤
Issuer holdings ───┼──> pipeline/ (Python) ──> site/data/*.json ──> git commit
config/*.yaml  ────┘                                                   │
                                                                       v
                                       GitHub Pages (deploy after push / refresh)
                                                                       │
                                                                       v
                                                                      User 

Re-screen (on request): Claude Code edits config/ ──> runs pipeline ──> branch ──> User approves ──> merge
```

Two separate jobs. Keep them separate.

| Job | Changes | Runs | Who |
|---|---|---|---|
| **Refresh** | Prices, net assets, fees, holdings, scores, ranks | Daily, automatic | GitHub Actions. No AI. |
| **Re-screen** | Universe rules, themes, overrides, exclusions, issuer links, holdings sources, holding aliases | On request | Claude Code, edits `config/` only |

The refresh job re-applies the theme rules to the full Nasdaq directory each day. So new launches whose names match an existing rule enter automatically. Re-screen is for judgment calls the rules can't make.

## 3. Repo layout (suggested; builder may adjust)

```
config/
  themes.yaml          # taxonomy, exclusion regex, overrides, excluded tickers (seeded)
  issuer_links.json    # ticker -> official issuer fund page (seeded, 97 funds)
  aum_overrides.yaml   # manual net assets from issuer sites (seeded)
  holdings_sources.yaml # ticker -> issuer holdings file URL + parser name
  holding_aliases.yaml # company names that should match across funds (e.g. ADR vs local listing)
  settings.yaml        # gates, weights, windows, top-N, data source
pipeline/              # Python 3.12+: fetch, classify, gate, score, export, checks
  sources/             # data-source adapters (yahoo first; same interface for a paid API later)
    issuers/           # one holdings parser per issuer file format (iShares, Global X, ARK, ...)
tests/
site/
  index.html, app.js, style.css
  vendor/              # charting lib copied locally (no CDN)
  data/                # generated JSON (committed by the daily job)
reports/               # re-screen reports
seed/                  # 2026-10-06 baseline from the Notion version (read-only reference)
.github/workflows/     # refresh.yml
CLAUDE.md              # standing rules for the agent
.claude/commands/rescreen.md
CHANGELOG.md
```

## 4. Data sources

| Data | Source | Notes |
|---|---|---|
| Universe | `https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt` | Keep rows with `ETF = Y` and `Test Issue = N`. Covers all US exchanges. |
| Daily prices (adjusted close, close, volume), first trade date | Yahoo chart endpoint, 5-year daily range | Adjusted close = total return including distributions. |
| Net assets, expense ratio, category, top 10 holdings | Yahoo quoteSummary (`summaryDetail`, `fundProfile`, `topHoldings`, `price`) | Needs cookie + crumb session. Top 10 is used only as the fallback for the top-3 holdings column, never for overlap. |
| Full holdings (every position, weight, identifiers, as-of date) | Issuer holdings file or page, URL in `config/holdings_sources.yaml` | Used for overlap and the top-3 holdings column. Fetched for eligible funds. See 4.1. |
| Net-asset fallback | Yahoo quote `netAssets`, then `config/aum_overrides.yaml` | Mark the source on the site (`*`). |
| Fund page links | `config/issuer_links.json` | Ticker links go to issuer pages, never Yahoo. Missing link → show plain ticker and list it in the re-screen report. |

Requirements:
- **Yahoo is unofficial and can break or block cloud IPs.** Put all Yahoo calls behind one adapter with a fixed interface (history, profile). A paid provider (EODHD, FMP, Tiingo) must be addable as a second adapter selected in `settings.yaml`, with no changes elsewhere.
- Throttle (about 3–4 requests/second max), retry with backoff on 429/5xx, and reuse one HTTP session.
- Fetch only what's needed: full profile + 5-year prices for funds that pass name classification (roughly 350–450), not all 5,758 ETFs.
- Per-fund failure: reuse that fund's last good data and mark it stale. Never silently drop a fund.

### 4.1 Issuer holdings

Why: Yahoo lists only each fund's top 10 holdings, and gives the same company different symbols in different funds (e.g. Airbus is `AIR.PA` in NATO but `EADSY` in EUAD). Both make overlap come out too low. The issuer's own holdings file lists every position.

- Source: the daily holdings file (CSV/XLSX/JSON) or holdings table published on the issuer's fund page. Record the URL and parser per ticker in `config/holdings_sources.yaml`.
- One parser per issuer file format, in `pipeline/sources/issuers/`, all returning the same shape: as-of date and a list of rows (name, ticker, ISIN/CUSIP/SEDOL if given, asset type, weight as % of net assets).
- Keep the issuer's weights as published. Drop cash, currency, futures, swaps and other non-equity rows from overlap; don't rescale the remaining weights.
- Same rules as Yahoo: throttle, retry with backoff, reuse last good data and mark it stale with its as-of date.
- A fund with no source or a failed parse gets no overlap numbers. Show "full holdings unavailable" and list it in the re-screen report. Don't fill in with Yahoo's top 10: mixing full and partial lists makes numbers incomparable.
- Holdings failures don't block publishing (they don't affect scores).

## 5. Screening method (must match exactly)

This is the method user approved on the Notion page. Do not change it without his approval.
### 5.1 Universe and classification
1. Start from the Nasdaq directory (ETFs only, no test issues).
2. Drop any fund whose name matches `exclude_name_regex` (leveraged/inverse, option-income, buffer, bond, spot crypto, futures, etc.) or whose ticker is in `exclude_tickers`.
3. Classify by fund name, case-insensitive. Rules are ordered; **first match wins**. `overrides` (ticker → theme) beat the rules.
4. Each theme belongs to one of four groups: Technology, Physical world, Social, Broad thematic (Morningstar's framework).

### 5.2 Gates (pass/fail, in this order; record the first failure as the fund's status)
| Gate | Rule | Status text |
|---|---|---|
| Price data | Has price history | `No price data` |
| Net assets | Has a net-asset value from any source | `No net-asset data` |
| Size | Age ≥ 3 years: net assets ≥ \$100M. Age < 3 years: ≥ \$25M | `Under $100M (established minimum)` / `Under $25M (emerging minimum)` |
| Liquidity | Mean of (close × volume) over the last 63 trading days ≥ \$0.5M | `Under $0.5M avg daily $ volume` |

Age = (last price date − first trade date) / 365.25 days.

### 5.3 Shared performance window (per theme)
- **Measured funds** = eligible funds aged ≥ 0.5 years. Funds under 0.5 years are flagged 🆕 and don't affect the window.
- Window end = the latest trading date common to all measured funds in the theme.
- Window start = the later of (a) the latest first-trade date among measured funds and (b) end − 3 years; then moved forward to the first common trading date on or after it.
- All measured funds use the **same aligned daily observations** (intersection of their trading dates). No prices before the start date.
- L = exact calendar days from start to end / 365.25.
- If L < 0.5 years, or the theme has no measured funds, performance is unmeasured for the whole theme.

### 5.4 Metrics
- Cumulative total return = P_end / P_start − 1 (adjusted close). This is what the return column shows.
- Annualized return = (P_end / P_start)^(1/L) − 1, for every measured window including those under 1 year.
- Annualized volatility = sample std (ddof=1) of daily log returns on the aligned dates × √252.
- Ratio = annualized return / annualized volatility. Higher is better. Not Sharpe (no risk-free rate subtracted).

### 5.5 Score (0–100, within theme only)
Percentiles are computed among eligible funds in the same theme, using average ranks for ties: percentile = rank / n, so the best fund gets 1.0 and a sole fund gets 1.0.

| Part | Weight | Input | Missing value |
|---|---|---|---|
| Size | 40% | Net assets (higher better) | n/a (gated) |
| Cost | 20% | Expense ratio (lower better) | Neutral 0.5 |
| Performance | 40% | Ratio, percentile **among measured funds only** | Neutral 0.5, flagged † |

Score = 100 × (0.4 × size + 0.2 × cost + 0.4 × perf). Rank by score within theme; break ties by net assets. Scores aren't comparable across themes; the UI must say so.

### 5.6 Display defaults
- Top 3 per theme, **no minimum score**.
- Themes grouped by the four groups, ordered by the largest fund's net assets.
- Themes with no eligible fund are listed separately with their candidates and failure reasons.
- Dollar volume is shown but not scored (it rises with size and would count size twice).

## 6. Website features

All views read static JSON. No server code.

1. **Main screen.** Table grouped by group → theme. Columns: rank, ticker (issuer link), name, launched, net assets (with source marker and as-of date), expense ratio, window (dates), cumulative return, ratio, avg daily \$ volume, top 3 holdings, score, flags (🆕, †, stale). Sortable columns. Filter by group, theme, text search, 🆕 only, hide funds under \$50M. Toggle **Top 3 / All eligible / All screened** (the last one replaces the Notion appendix and shows the gate status of every fund).
2. **Live weights.** Sliders for size/cost/performance weights (normalized to 100%) and top-N. Recompute scores and ranks in the browser from the per-fund percentiles in the JSON. "Reset to default" button. Gates and windows stay as computed by the pipeline; say so next to the sliders.
3. **Price charts.** Click a fund: its 3-year adjusted-close chart. Click a theme: all measured peers rebased to 100 at the window start, with the window shaded. Load per-ticker price files lazily.
4. **Ranking history.** Each daily run saves a compact snapshot (ticker → theme, rank, score, net assets). Show rank change vs 1 week and 1 month in the main table, and a rank-over-time line per fund. Show funds that entered or left a theme's top 3 in the last 30 days.
5. **Overlap.** Using full issuer holdings (4.1): overlap(A, B) = Σ min(weight_A, weight_B) over shared companies. Show a matrix for the funds in a theme and a two-fund picker across themes. Highlight pairs ≥ 30%. Show each fund's holdings as-of date; flag pairs whose dates differ by more than 7 days.
   - **Shared company:** match at company level, so ADRs, GDRs, local listings and share classes of one company count as one holding (sum their weights within a fund first). Why: overlap measures exposure to the same business, and issuers hold different listings of it. Match on identifier (ISIN, else CUSIP/SEDOL) when both rows have one, then on normalized company name (lowercase; drop ADR/GDR, class, "ordinary shares" and legal suffixes like Inc/Corp/PLC/AG/SE/SA/Ltd), then on `config/holding_aliases.yaml`.
   - Load per-fund holdings files lazily (`site/data/holdings/<TICKER>.json`).
6. **Status bar.** Data as-of date, last successful run, fund count, failed fetches, and a stale banner if data is older than 2 trading days. Link to a "Method" panel that renders section 5 in plain English.
7. Responsive down to 390 px wide. Keyboard-accessible controls. No external CDNs, fonts or trackers. Add `noindex`.
8. **Momentum board.** Each theme's return per period = median of its eligible funds' 1M / 3M / 6M / 1Y price return (last close vs the last close on or before 30 / 91 / 182 / 365 days earlier). Themes sit in four buckets by 1M vs 3M sign (zero counts as up): Rising (both up), Recovering (1M up, 3M down), Fading (1M down, 3M up), Falling (both down); themes with no 1M or 3M are listed as too new. Within a bucket, sorted by 1M, tiles coloured by 1M. Clicking a theme opens a side panel with its eligible funds (by rank; top 3 by score highlighted) and their four returns, green for gains, red for losses, darker for bigger moves, empty when the fund is younger than the period. Below it, a chart of those funds' last year, each rebased to 100 at its last close on or before one year before the latest price date (only the top 3 by current score, so the live weights apply; each line labelled with its symbol at its end, end values in the legend; if any of the top 3 is younger than a year, the chart starts instead at the first date all three share, i.e. the youngest one's first close, and says so), with the `benchmark` fund in `config/settings.yaml` (QQQ) as a dashed line; 1M / 3M / 6M / 1Y buttons redraw it over that period (30 / 91 / 182 / 365 days, rebased at its start the same way), and the choice carries over to the next chart opened; its price file is published but it is never classified, gated or scored. A "Defensive sectors" row shows the reference funds in `config/settings.yaml` (XLU, XLP, XLV, XLRE) with their own 1M return and bucket, for comparison; they are never classified, gated or scored. Clicking one shows their four returns next to the benchmark's (QQQ), and a chart of their last year with the benchmark as a dashed line, all rebased to 100 at the same start; their price files are published for that. Display only: never scored.
9. **Stocks held across themes.** From the issuer holdings (4.1, matched to companies as in 6.5): a stock counts in a theme when an eligible fund in that theme holds it at 1% or more (classes and listings summed per fund). Funds in the Broad thematic group are left out. List stocks held in 2+ themes, ranked by theme count, then fund count, then average weight; top 50 with "Show all". Each row: name, ticker, country, Direct / Via ETF, theme count, fund count, average weight, theme names. Direct = based in the US or Canada (Canada assumed TSX-listed), or a US exchange listing in the Nasdaq directory matched by company name, or by the fund's ticker when the names share a distinctive word (OTC does not count). Filters: themes in a momentum bucket (6.8), Via ETF only. Clicking a stock lists its funds by weight, largest highlighted, with each theme's bucket. Written by the pipeline to `site/data/stocks.json`. Display only: never scored.

## 7. Daily refresh job (GitHub Actions)

- Schedule: weekdays 22:30 UTC (after the US close in both EST and EDT), plus manual `workflow_dispatch`.
- Steps: fetch directory → classify → fetch data → gate → score → fetch issuer holdings for eligible funds → **checks** → write `site/data/` → commit and push (then `pages.yml` deploys `site/` to GitHub Pages).
- **Checks before publishing.** If any fails, don't overwrite the latest data. Open a GitHub issue with the reason, and let the site show the stale banner.
  - ≥ 90% of classified funds fetched successfully.
  - No theme loses all its eligible funds only because of fetch errors.
  - Net-asset changes over ±50% day over day are listed in the run log (don't block).
  - The JSON validates against its schema.
- Commit only generated JSON. Don't commit raw API responses. Keep history snapshots small (compact JSON, one file per day).
- Run time target: under 15 minutes.

## 8. Hosting

- Public GitHub repo (free Pages needs one). The site is public; `noindex` stays.
- GitHub Pages, source **GitHub Actions**, deploying `site/` via `.github/workflows/pages.yml`.
- No secrets needed for Yahoo. The workflow needs `contents: write` and `issues: write` permissions only.

## 9. Re-screen (Claude Code, on request)

Triggered when user asks ("re-screen", or `/rescreen`). Procedure is in `.claude/commands/rescreen.md`. Summary:

1. Generate a re-screen report (`reports/rescreen-YYYY-MM-DD.md`) with:
   - New ETFs in the directory since the last re-screen: classified, excluded and unclassified.
   - **Possible misses:** unclassified ETFs whose name or Yahoo category suggests a theme (for example "Innovation", "Next", "Future", "Technology", or a category like "Miscellaneous Sector").
   - **Possible false positives:** classified funds that look non-thematic (for example "Blue Chip" matching "chip").
   - Themes with 0–1 eligible funds; themes with more than ~15 eligible funds (candidates to split).
   - Funds whose name matched two or more themes (rule order decided).
   - Missing issuer links; net-asset overrides older than 45 days; delisted funds.
   - Eligible funds without a working holdings source; holdings files older than 7 days; holding names that look like the same company but didn't match (candidates for `holding_aliases.yaml`).
2. Propose config changes with a one-line reason each. Edit `config/` only. Don't change scoring code or section 5 unless user asks.
3. Run tests and the full pipeline locally. Summarize top-3 changes per theme (entered / left) caused by the config edits.
4. Commit to branch `rescreen/YYYY-MM-DD`, add a CHANGELOG entry, and **wait for user's approval before merging.**

## 10. Seed data (in `seed/` and `config/`)

- `config/themes.yaml` — the exact 44-theme taxonomy, exclusion regex, ticker overrides and excluded tickers used on 2026-10-06.
- `config/issuer_links.json` — issuer pages for the 97 funds shown on 2026-10-06.
- `config/aum_overrides.yaml` — issuer net assets for DISK, LAZR, NASA, PSOX, WELD (as of 2026-08-31).
- `seed/universe_2026-10-06.csv` — the 364 classified funds with theme and gate status. Use it as a regression baseline for the classifier.

## 11. Acceptance criteria

Method
- [ ] Unit tests with synthetic prices verify: window alignment (intersection of dates, no pre-start prices), exact elapsed days, annualization, ddof=1 volatility, percentile ties, neutral 0.5 for missing fee and unmeasured performance, sole-fund score = 100 when its fee is known.
- [ ] Classifier on today's directory reproduces `seed/universe_2026-10-06.csv` theme assignments for every ticker still listed. Any differences are listed and explained.
- [ ] Known cases: LAZR → Photonics & optics; MJ → Cannabis (override); a "Blue Chip" fund → excluded; a 2x leveraged fund → excluded.

Pipeline
- [ ] A manual workflow run completes in under 15 minutes and commits new data.
- [ ] Simulated Yahoo failure (adapter raising errors for 20% of funds) → nothing published, issue opened, site shows stale banner.
- [ ] Switching `data_source` to a stub adapter needs no code changes outside `pipeline/sources/`.

Site
- [ ] Every number on the main screen matches the pipeline output.
- [ ] Default weights reproduce the pipeline's ranks exactly; changing sliders reorders live; reset restores.
- [ ] Charts, history (after ≥ 2 runs) and overlap work; no console errors.
- [ ] Overlap uses issuer holdings: unit test where fund A holds a local listing and fund B the ADR of the same company → counted as shared. NATO vs EUAD overlap includes Airbus and BAE Systems.
- [ ] Every eligible fund either has parsed issuer holdings or appears in the re-screen report as missing a holdings source.
- [ ] Usable at 1440 px and 390 px.
- [ ] The GitHub Pages URL loads the site after a push to `main` and after a refresh.

Process
- [ ] README covers setup (GitHub Pages), how to run locally, and how to re-screen.
- [ ] Don't commit or merge anything to `main` beyond the initial scaffold without user's review.

## 12. Out of scope (v1)

- Bid-ask spread and premium/discount data.
- Canadian (TSX) listings.
- Alerts or email digests.
