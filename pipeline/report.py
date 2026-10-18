"""Re-screen report (SPEC 9.1): python3 -m pipeline.report [--date YYYY-MM-DD]

Lists candidates as questions; it makes no classification decisions.
Needs site/data/screen.json from a pipeline run (themes, statuses, issuer links).
"""
import argparse
import csv
from datetime import date
from difflib import SequenceMatcher
import json
from pathlib import Path
import re

import yaml

from .method import classify
from .sources.directory import URL, parse
from .sources.http import Session

ROOT = Path(__file__).resolve().parents[1]
SMALL, LARGE = 1, 15  # SPEC 9.1: 0-1 eligible funds; more than ~15 eligible funds
OVERRIDE_DAYS, HOLDINGS_DAYS = 45, 7
# Name cues only. Yahoo category is not used: fetching it for ~5,000 unclassified ETFs is out of scope here.
MISS_CUES = r"innovat|\bnext\b|future|disrupt|technolog|\btech\b|digital|smart|revolution|frontier|transform|thematic|megatrend|new economy"
# Fund-company names that contain a cue word (Innovator, Frontier Asset, Day Hagan Smart Sector); removed before the cue search.
ISSUER_NAMES = r"innovator|frontier asset|day hagan smart sector"
FALSE_POSITIVE_CUES = r"blue ?chip|large[- ]cap|mid[- ]cap|small[- ]cap|total market|s&p 500|broad market|equal weight|dividend|aristocrat"
NON_EQUITY = r"cash|currenc|future|swap|option|forward|derivative|money market"
# Legal suffixes dropped by SPEC 6.5 name matching (the real matcher lives in the holdings code).
NAME_NOISE = {"inc", "incorporated", "corp", "corporation", "plc", "ag", "se", "sa", "ltd", "limited", "nv", "co",
              "adr", "gdr", "class", "a", "b", "c", "ordinary", "shares", "share", "the"}
ALIAS_SIMILARITY = 0.85


def classify_all(funds, taxonomy):
    """Outcome per fund: classified (theme), excluded (hit an exclusion rule), unclassified (no theme, not excluded)."""
    result = {}
    for f in funds:
        theme = classify(f["ticker"], f["name"], taxonomy)
        # "Excluded" = an exclusion rule fired. classify checks exclusions first, then overrides, then theme rules.
        # So with no theme rules and a dummy override for this ticker, it returns the dummy unless an exclusion fired
        # (None). This reuses classify's own exclusion test instead of copying it.
        probe = {**taxonomy, "themes": [], "overrides": {f["ticker"]: True}}
        if theme:
            result[f["ticker"]] = ("classified", theme)
        elif not classify(f["ticker"], f["name"], probe):
            result[f["ticker"]] = ("excluded", None)
        else:
            result[f["ticker"]] = ("unclassified", None)
    return result


def load_baseline(reports_dir, seed_dir, today):
    """Last re-screen = newest reports/rescreen-*.universe.csv before today; else newest seed/universe_*.csv.

    The saved universe holds every directory ETF, so excluded/unclassified new funds can be listed.
    The seed holds classified funds only (`full` False).
    """
    saved = sorted(p for p in Path(reports_dir).glob("rescreen-*.universe.csv")
                   if date.fromisoformat(p.name[len("rescreen-"):len("rescreen-") + 10]) < today)
    path = saved[-1] if saved else next(iter(sorted(Path(seed_dir).glob("universe_*.csv"), reverse=True)), None)
    if path is None:
        return {"label": "none found", "full": False, "tickers": {}}
    with open(path, newline="") as file:
        rows = list(csv.DictReader(file))
    return {"label": path.name, "full": bool(saved),
            "tickers": {r["ticker"]: {"name": r["name"], "theme": r["theme"] or None} for r in rows}}


def lines(items, empty="None."):
    return items if items else [empty]


def fund_line(ticker, name, note=None):
    return f"- {ticker} - {name}" + (f" ({note})" if note else "")


def alias_candidates(holdings):
    names = {}  # normalized name -> {"display": set, "ids": set}
    for file in holdings.values():
        for h in file["holdings"]:
            if re.search(NON_EQUITY, h.get("asset_type") or "", re.I):
                continue
            words = [w for w in re.sub(r"[^a-z0-9 ]", " ", h["name"].lower()).split() if w not in NAME_NOISE]
            if not words:
                continue
            entry = names.setdefault(" ".join(words), {"display": set(), "ids": set()})
            entry["display"].add(h["name"])
            entry["ids"] |= {h[k] for k in ("isin", "cusip", "sedol", "ticker") if h.get(k)}
    buckets = {}
    for key in names:
        buckets.setdefault(key.split()[0], []).append(key)
    found = []
    for keys in buckets.values():
        for i, a in enumerate(keys):
            for b in keys[i + 1:]:
                ratio = SequenceMatcher(None, a, b).ratio()
                if ratio >= ALIAS_SIMILARITY and not names[a]["ids"] & names[b]["ids"]:
                    found.append((ratio, min(names[a]["display"]), min(names[b]["display"])))
    return sorted(found, reverse=True)


def holdings_section(screen, holdings, today):
    if not holdings:
        return ["holdings not yet available (no files in the holdings folder; the holdings ticket has not written any)."]
    eligible = sorted(f["ticker"] for f in screen["funds"] if f["status"] == "Eligible")
    out = ["### Eligible funds without a holdings file", ""]
    reasons = yaml.safe_load((ROOT / "config/holdings_missing.yaml").read_text()) or {}  # ticker -> why there is no source
    out += lines([f"- {t}" + (f": {reasons[t]}" if t in reasons else "") for t in eligible if t not in holdings])
    out += ["", f"### Stale holdings files (marked stale, or as_of older than {HOLDINGS_DAYS} days)", ""]
    stale = []
    for ticker, file in sorted(holdings.items()):
        age = (today - date.fromisoformat(file["as_of"])).days
        if file.get("stale") or age > HOLDINGS_DAYS:
            stale.append(f"- {ticker}: as of {file['as_of']} ({age} days)" + (", fetch failed, last good file reused" if file.get("stale") else ""))
    out += lines(stale)
    out += ["", "### Alias candidates (similar company names that did not match; for `config/holding_aliases.yaml`)", ""]
    out += lines([f"- {a} / {b} (similarity {r:.2f})" for r, a, b in alias_candidates(holdings)])
    return out


def build_report(funds, taxonomy, screen, baseline, overrides, holdings, today, outcome=None):
    outcome = outcome or classify_all(funds, taxonomy)
    names = {f["ticker"]: f["name"] for f in funds}
    themes = taxonomy["themes"]
    base = baseline["tickers"]
    new = sorted(t for t in names if t not in base)
    out = [f"# Re-screen report {today.isoformat()}", "",
           f"Baseline: {baseline['label']}. {len(funds)} ETFs in the directory. This report lists candidates as questions; nothing here is decided.", ""]

    out += ["## New ETFs since last re-screen", ""]
    for kind in ("classified", "excluded", "unclassified"):
        if kind != "classified" and not baseline["full"]:
            break
        rows = [fund_line(t, names[t], outcome[t][1]) for t in new if outcome[t][0] == kind]
        out += [f"### {kind.capitalize()} ({len(rows)})", ""] + lines(rows) + [""]
    if not baseline["full"]:
        others = sum(outcome[t][0] != "classified" for t in new)
        out += [f"The baseline holds classified funds only, so {others} new excluded or unclassified ETFs cannot be told apart from old ones and are not listed.", ""]

    out += ["## Possible misses (unclassified, name suggests a theme)", ""]
    out += lines([fund_line(t, names[t]) for t in sorted(names)
                  if outcome[t][0] == "unclassified" and re.search(MISS_CUES, re.sub(ISSUER_NAMES, " ", names[t], flags=re.I), re.I)]) + [""]

    out += ["## Possible false positives (classified, name looks non-thematic)", ""]
    out += lines([fund_line(t, names[t], outcome[t][1]) for t in sorted(names)
                  if outcome[t][0] == "classified" and re.search(FALSE_POSITIVE_CUES, names[t], re.I)]) + [""]

    out += ["## Multi-theme name matches (first rule won)", ""]
    multi = []
    for t in sorted(names):
        if outcome[t][0] != "classified" or t in taxonomy["overrides"]:
            continue
        hits = [r["theme"] for r in themes if re.search(r["match"], names[t], re.I)]
        if len(hits) > 1:
            multi.append(fund_line(t, names[t], " | ".join(hits)))
    out += lines(multi) + [""]

    eligible = {t["theme"]: t["eligible"] for t in screen["themes"]}
    counts = [(r["theme"], eligible.get(r["theme"], 0)) for r in themes]
    out += ["## Theme sizes", "", f"### Themes with {0} or {SMALL} eligible funds", ""]
    out += lines([f"- {t} ({n})" for t, n in counts if n <= SMALL]) + ["", f"### Themes with more than {LARGE} eligible funds (candidates to split)", ""]
    out += lines([f"- {t} ({n})" for t, n in counts if n > LARGE]) + [""]

    out += ["## Missing issuer links", ""]
    missing = set(screen["missing_issuer_links"])
    top = sorted(f["ticker"] for f in screen["funds"] if f["ticker"] in missing and f["status"] == "Eligible" and f["rank"] <= 3)
    eligible = sorted(f["ticker"] for f in screen["funds"] if f["ticker"] in missing and f["status"] == "Eligible" and f["ticker"] not in top)
    rest = sorted(missing - set(top) - set(eligible))
    out += [f"Top 3 funds ({len(top)}): " + (", ".join(top) or "none"), "",
            f"Other eligible funds ({len(eligible)}): " + (", ".join(eligible) or "none"), "",
            f"<details><summary>Other funds ({len(rest)})</summary>", "", ", ".join(rest), "", "</details>", ""]

    out += [f"## Net-asset overrides older than {OVERRIDE_DAYS} days", ""]
    old = [(t, (today - date.fromisoformat(str(o["as_of"]))).days) for t, o in sorted(overrides.items())]
    out += lines([f"- {t}: as of {overrides[t]['as_of']} ({d} days)" for t, d in old if d > OVERRIDE_DAYS]) + [""]

    out += ["## Delisted funds (classified at baseline, no longer in the directory)", ""]
    out += lines([fund_line(t, v["name"], v["theme"]) for t, v in sorted(base.items()) if v["theme"] and t not in names]) + [""]

    out += ["## Holdings", ""] + holdings_section(screen, holdings, today) + [""]
    return "\n".join(out)


def write_universe(path, funds, outcome):
    with open(path, "w", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(["ticker", "name", "outcome", "theme"])
        writer.writerows([f["ticker"], f["name"], *(outcome[f["ticker"]][0], outcome[f["ticker"]][1] or "")] for f in sorted(funds, key=lambda f: f["ticker"]))


def main():
    parser = argparse.ArgumentParser(description="Write the re-screen report")
    parser.add_argument("--date", type=date.fromisoformat, default=date.today())
    parser.add_argument("--directory", type=Path, help="Saved Nasdaq directory for offline use")
    parser.add_argument("--screen", type=Path, default=ROOT / "site/data/screen.json")
    parser.add_argument("--holdings-dir", type=Path, default=ROOT / "site/data/holdings")
    parser.add_argument("--reports-dir", type=Path, default=ROOT / "reports")
    args = parser.parse_args()
    taxonomy = yaml.safe_load((ROOT / "config/themes.yaml").read_text())
    funds = parse(args.directory.read_text() if args.directory else Session().get(URL))
    screen = json.loads(args.screen.read_text())
    overrides = yaml.safe_load((ROOT / "config/aum_overrides.yaml").read_text())["funds"]
    files = {p.stem: json.loads(p.read_text()) for p in args.holdings_dir.glob("*.json")}
    baseline = load_baseline(args.reports_dir, ROOT / "seed", args.date)
    outcome = classify_all(funds, taxonomy)
    text = build_report(funds, taxonomy, screen, baseline, overrides, files or None, args.date, outcome)
    (args.reports_dir / f"rescreen-{args.date}.md").write_text(text)
    write_universe(args.reports_dir / f"rescreen-{args.date}.universe.csv", funds, outcome)
    print(f"Wrote {args.reports_dir / f'rescreen-{args.date}.md'}")


if __name__ == "__main__":
    main()
