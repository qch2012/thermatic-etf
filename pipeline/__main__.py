import argparse
from datetime import date, datetime, timezone
import json
import logging
from pathlib import Path
import tempfile

import yaml

from .method import classify, score
from .sources import create
from .sources.directory import URL, parse
from .sources.http import Session

ROOT = Path(__file__).resolve().parents[1]


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, allow_nan=False, indent=2) + "\n"
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as file:
        file.write(text)
        temporary = Path(file.name)
    temporary.replace(path)


def run(settings, output, cache_dir, directory_text=None):
    taxonomy = yaml.safe_load((ROOT / "config/themes.yaml").read_text())
    themes = {rule["theme"]: rule["group"] for rule in taxonomy["themes"]}
    theme = settings["theme"]
    if theme not in themes:
        raise ValueError(f"Unknown theme: {theme}")
    source_name = settings["data_source"]
    source = create(source_name)
    directory = parse(directory_text if directory_text is not None else Session().get(URL))
    candidates = [f for f in directory if classify(f["ticker"], f["name"], taxonomy) == theme]
    if not candidates:
        raise ValueError(f"No classified funds for {theme}; not publishing")
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
    window = score(funds)
    for fund in funds:
        del fund["prices"]
    result = {"theme": theme, "group": themes[theme], "data_source": source_name,
              "synthetic": source_name == "stub", "generated_at": datetime.now(timezone.utc).isoformat(),
              "window": window, "funds": sorted(funds, key=lambda f: (f["rank"] is None, f["rank"] or 0, f["ticker"])),
              "failed_fetches": failures, "missing_issuer_links": [f["ticker"] for f in funds if not f["issuer_url"]]}
    write_json(output, result)
    return result


def main():
    parser = argparse.ArgumentParser(description="Refresh one thematic ETF table")
    parser.add_argument("--settings", type=Path, default=ROOT / "config/settings.yaml")
    parser.add_argument("--output", type=Path, default=ROOT / "site/data/screen.json")
    parser.add_argument("--directory", type=Path, help="Saved Nasdaq directory for offline testing")
    args = parser.parse_args()
    result = run(yaml.safe_load(args.settings.read_text()), args.output, ROOT / ".cache", args.directory.read_text() if args.directory else None)
    print(f"Wrote {args.output}: {len(result['funds'])} funds ({result['data_source']})")


if __name__ == "__main__":
    main()
