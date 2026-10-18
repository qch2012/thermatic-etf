import argparse
from datetime import date, datetime, timezone
import json
import logging
from pathlib import Path
import tempfile

import yaml

from .holdings import fill_holdings
from .method import classify, score
from .sources import create
from .sources.directory import URL, parse
from .sources.http import Session

ROOT = Path(__file__).resolve().parents[1]
GROUPS = ["Technology", "Physical world", "Social", "Broad thematic"]
# Copy of the default weights hard-coded in method.score (SPEC 5.5); a test checks they reproduce its scores.
WEIGHTS = {"size": 0.4, "cost": 0.2, "performance": 0.4}


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, allow_nan=False, indent=2) + "\n"
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as file:
        file.write(text)
        temporary = Path(file.name)
    temporary.replace(path)


def three_years_before(day):
    try:
        return day.replace(year=day.year - 3)
    except ValueError:  # Feb 29
        return day.replace(year=day.year - 3, day=28)


def run(settings, output, cache_dir, directory_text=None):
    taxonomy = yaml.safe_load((ROOT / "config/themes.yaml").read_text())
    themes = {rule["theme"]: rule["group"] for rule in taxonomy["themes"]}
    source_name = settings["data_source"]
    source = create(source_name)
    directory = parse(directory_text if directory_text is not None else Session().get(URL))
    candidates = []
    for f in directory:
        theme = classify(f["ticker"], f["name"], taxonomy)
        if theme:
            candidates.append({**f, "theme": theme, "group": themes[theme]})
    if not candidates:
        raise ValueError("No classified funds; not publishing")
    links = json.loads((ROOT / "config/issuer_links.json").read_text())
    overrides = yaml.safe_load((ROOT / "config/aum_overrides.yaml").read_text())["funds"]
    funds, failures = [], []
    for candidate in candidates:
        ticker = candidate["ticker"]
        # Provider-specific caches prevent synthetic data from becoming a Yahoo fallback.
        cache = cache_dir / source_name / f"{ticker}.json"
        try:
            data = {**source.history(ticker), **source.profile(ticker)}
            data["fetched_at"] = datetime.now(timezone.utc).isoformat()
            write_json(cache, data)
            stale = False
        except Exception as error:
            logging.warning("%s: %s", ticker, error)
            failures.append({"ticker": ticker, "error": str(error)})
            if not cache.exists():
                raise RuntimeError(f"{ticker}: fetch failed and no last-good data; not publishing") from error
            data = json.loads(cache.read_text())
            stale = True
        for warning in data.get("warnings", []):
            logging.warning("%s: %s", ticker, warning)
        fund = {**candidate, **data, "stale": stale, "issuer_url": links.get(ticker)}
        fund["assets_as_of"] = data["fetched_at"][:10]
        fund["assets_stale"] = stale
        if fund["net_assets"] is None and ticker in overrides:
            override = overrides[ticker]
            fund.update(net_assets=override["net_assets_musd"] * 1e6, assets_source=override["source"], assets_as_of=override["as_of"])
            fund["assets_stale"] = (date.today() - date.fromisoformat(override["as_of"])).days > 45
        funds.append(fund)
    if len(failures) / len(funds) > 0.1:
        raise RuntimeError("Fewer than 90% of candidates fetched successfully; not publishing")
    summaries, no_eligible = [], []
    for theme, group in themes.items():
        members = [f for f in funds if f["theme"] == theme]
        window = score(members)
        eligible = [f["net_assets"] for f in members if f["status"] == "Eligible"]
        if eligible:
            summaries.append({"theme": theme, "group": group, "window": window, "candidates": len(members),
                              "eligible": len(eligible), "largest_net_assets": max(eligible)})
        else:
            no_eligible.append({"theme": theme, "group": group, "candidates": [
                {key: f[key] for key in ("ticker", "name", "status")} for f in sorted(members, key=lambda f: f["ticker"])]})
    # SPEC 5.6: themes by largest eligible fund; themes without one listed separately. Group order is our choice.
    summaries.sort(key=lambda t: (GROUPS.index(t["group"]), -t["largest_net_assets"], t["theme"]))
    no_eligible.sort(key=lambda t: (GROUPS.index(t["group"]), t["theme"]))
    order = {t["theme"]: i for i, t in enumerate(summaries + no_eligible)}
    # Price files for the charts: last 3 calendar years of adjusted closes, every fund with price data.
    last_dates = [f["prices"][-1]["date"] for f in funds if f["prices"]]
    for fund in funds:
        prices = [p for p in fund.pop("prices") if p["adjusted_close"] is not None]
        if prices:
            start = three_years_before(date.fromisoformat(prices[-1]["date"])).isoformat()
            prices = [p for p in prices if p["date"] >= start]
            write_json(output.parent / "prices" / f"{fund['ticker']}.json", {"ticker": fund["ticker"],
                       "dates": [p["date"] for p in prices], "adjusted_close": [p["adjusted_close"] for p in prices]})
    if source_name != "stub":  # synthetic screens get no real holdings; keeps stub runs offline
        try:
            fill_holdings(funds, output.parent / "holdings", write_json)
        except Exception as error:  # SPEC 4.1: holdings failures never block publishing
            logging.warning("holdings skipped: %s", error)
            for fund in funds:
                fund.pop("top_holdings", None)
    result = {"data_source": source_name, "synthetic": source_name == "stub",
              "generated_at": datetime.now(timezone.utc).isoformat(), "data_as_of": max(last_dates, default=None),
              "weights": WEIGHTS, "themes": summaries,
              "no_eligible_themes": no_eligible,
              "funds": sorted(funds, key=lambda f: (order[f["theme"]], f["rank"] is None, f["rank"] or 0, f["ticker"])),
              "failed_fetches": failures, "missing_issuer_links": [f["ticker"] for f in funds if not f["issuer_url"]]}
    write_json(output, result)
    return result


def main():
    parser = argparse.ArgumentParser(description="Refresh the thematic ETF screen")
    parser.add_argument("--settings", type=Path, default=ROOT / "config/settings.yaml")
    parser.add_argument("--output", type=Path, default=ROOT / "site/data/screen.json")
    parser.add_argument("--directory", type=Path, help="Saved Nasdaq directory for offline testing")
    args = parser.parse_args()
    result = run(yaml.safe_load(args.settings.read_text()), args.output, ROOT / ".cache", args.directory.read_text() if args.directory else None)
    print(f"Wrote {args.output}: {len(result['funds'])} funds ({result['data_source']})")


if __name__ == "__main__":
    main()
