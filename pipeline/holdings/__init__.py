"""Issuer holdings (SPEC 4.1, 6.5): parse issuer files, match companies across funds, write site/data/holdings/."""
import csv
from datetime import datetime, timezone
import io
import json
import logging
from pathlib import Path
import re

import yaml

# Issuer downloads are not Yahoo; they reuse the shared HTTP session for its throttle (≤3.3 req/s),
# retry with backoff on 429/5xx, and User-Agent.
from ..sources.http import Session

ROOT = Path(__file__).resolve().parents[2]


def parse_ishares(text):
    """iShares `latest-holdings.csv`: a few header lines, then a table starting at `Ticker,Name,...`."""
    lines = text.splitlines()
    as_of = next(row[1] for row in csv.reader(lines[:5]) if row and row[0] == "Fund Holdings as of")
    start = next(i for i, line in enumerate(lines) if line.startswith("Ticker,"))
    def weight(row):
        # Some funds publish "Market Weight" (share of net assets) and "Notional Weight" instead of "Weight (%)";
        # there futures show "-" (no market value), which the other layout prints as 0.00.
        text = (row.get("Weight (%)") or row["Market Weight"]).replace(",", "")
        return 0.0 if text == "-" else round(float(text) / 100, 10)

    holdings = [{"name": row["Name"], "ticker": row["Ticker"], "asset_type": row["Asset Class"], "weight": weight(row)}
                for row in csv.DictReader(io.StringIO("\n".join(lines[start:]))) if row["Name"]]
    return {"as_of": datetime.strptime(as_of, "%b %d, %Y").date().isoformat(), "holdings": holdings}


# SPEC 6.5: drop ADR/GDR, class, "ordinary shares" and legal suffixes. Only trailing words are dropped,
# so a name like "Co-Diagnostics" keeps its first word.
SUFFIXES = {"adr", "ads", "gdr", "sp", "spon", "sponsored", "unsp", "unspon", "unsponsored", "ordinary", "ord", "shares", "share",
            "inc", "corp", "corporation", "co", "company", "plc", "ag", "se", "sa", "spa", "ltd", "limited", "nv", "ab", "as", "asa",
            "oyj", "kgaa", "npv", "the"}


def normalize(name):
    words = re.sub(r"[^a-z0-9]+", " ", name.lower().replace(".", "")).split()
    while words:
        if words[-1] in SUFFIXES:
            words.pop()
        elif len(words) > 2 and words[-2] in {"class", "cl", "shs"} and len(words[-1]) == 1:
            del words[-2:]
        else:
            break
    return " ".join(words) or name.lower()


def is_equity(holding):
    return (holding.get("asset_type") or "").lower() == "equity"


def match_companies(files, aliases):
    """Give every equity row a `company` key shared by the same company in every fund (SPEC 6.5):
    same identifier (ISIN, CUSIP or SEDOL), same normalized name, or listed together in holding_aliases.yaml.
    Non-equity rows get `company: None` and are left out of top holdings and overlap."""
    parent = {}

    def find(node):
        parent.setdefault(node, node)
        while parent[node] != node:
            node = parent[node]
        return node

    def union(a, b):
        a, b = find(a), find(b)
        parent[max(a, b)] = min(a, b)  # smallest node is the root, so keys don't depend on file order

    for alias in aliases:
        for name in alias["names"][1:]:
            union("name:" + normalize(alias["names"][0]), "name:" + normalize(name))
    equity = [h for f in files for h in f["holdings"] if is_equity(h)]
    for h in equity:
        for field in ("isin", "cusip", "sedol"):
            if h.get(field):
                union("name:" + normalize(h["name"]), f"{field}:{h[field]}")
    for f in files:
        for h in f["holdings"]:
            h["company"] = find("name:" + normalize(h["name"])) if is_equity(h) else None


def top_holdings(file, n=3):
    """Largest equity companies by weight, share classes and listings of one company summed; name from its largest row."""
    companies = {}
    for h in sorted((h for h in file["holdings"] if h["company"]), key=lambda h: -h["weight"]):
        entry = companies.setdefault(h["company"], {"name": h["name"], "weight": 0.0})
        entry["weight"] = round(entry["weight"] + h["weight"], 10)
    return sorted(companies.values(), key=lambda c: (-c["weight"], c["name"]))[:n]


PARSERS = {"ishares": parse_ishares}


def refresh(funds, out_dir, sources, aliases, get, write):
    """Fetch each eligible fund's issuer file, write site/data/holdings/<TICKER>.json and set Fund.top_holdings.
    A failed fetch or parse reuses the last good file (stale); with none, the fund gets no holdings.
    Never raises for one fund: holdings don't affect scores, so they never block publishing (SPEC 4.1)."""
    files = {}
    for fund in funds:
        ticker, source = fund["ticker"], sources.get(fund["ticker"])
        if fund["status"] != "Eligible" or not source:
            continue
        path = out_dir / f"{ticker}.json"
        try:
            parsed = PARSERS[source["parser"]](get(source["url"]))
            files[ticker] = {"ticker": ticker, "as_of": parsed["as_of"], "fetched_at": datetime.now(timezone.utc).isoformat(),
                             "stale": False, "source": source["url"], "holdings": parsed["holdings"]}
        except Exception as error:
            logging.warning("%s holdings: %s", ticker, error)
            if path.exists():
                files[ticker] = {**json.loads(path.read_text()), "stale": True}
    match_companies(list(files.values()), aliases)
    for ticker, file in files.items():
        write(out_dir / f"{ticker}.json", file)
    for fund in funds:
        if fund["ticker"] in files:
            fund["top_holdings"] = top_holdings(files[fund["ticker"]])
        elif fund["status"] == "Eligible":
            logging.info("%s: full holdings unavailable", fund["ticker"])


def fill_holdings(funds, out_dir, write):
    """Pipeline entry point: config from config/holdings_sources.yaml and config/holding_aliases.yaml."""
    sources = yaml.safe_load((ROOT / "config/holdings_sources.yaml").read_text())
    aliases = yaml.safe_load((ROOT / "config/holding_aliases.yaml").read_text()) or []
    refresh(funds, out_dir, sources, aliases, Session().get, write)
