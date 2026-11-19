"""Issuer holdings (SPEC 4.1, 6.5): match companies across funds, top-3 holdings, write site/data/holdings/.
Downloading and parsing issuer files lives in pipeline/sources/issuers/."""
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import re

import yaml

from .sources.http import Session
from .sources.issuers import fetch

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "config/holdings_sources.yaml"
ALIASES = ROOT / "config/holding_aliases.yaml"

# SPEC 6.5: drop ADR/GDR, class, "ordinary shares" and legal suffixes. Only trailing words are dropped,
# so a name like "Co-Diagnostics" keeps its first word.
SUFFIXES = {"adr", "ads", "gdr", "sp", "spon", "sponsored", "unsp", "unspon", "unsponsored", "ordinary", "ord", "shares", "share",
            "inc", "corp", "corporation", "co", "company", "plc", "ag", "se", "sa", "spa", "ltd", "limited", "nv", "ab", "as", "asa",
            "oyj", "kgaa", "npv", "the"}


# Issuers spell some countries differently; without this, one company splits by spelling (Samsung, 2026-11-19).
COUNTRY_ALIASES = {"korea": "south korea", "korea (south)": "south korea", "korea, republic of": "south korea",
                   "republic of korea": "south korea", "russian federation": "russia"}


def country(location):
    location = (location or "").lower()
    return COUNTRY_ALIASES.get(location, location)


def normalize(name):
    words = re.sub(r"[^a-z0-9]+", " ", name.lower().replace(".", "")).split()
    while words:
        if words[-1] in SUFFIXES:
            words.pop()
        elif len(words) > 2 and words[-2] in {"class", "cl", "shs"} and len(words[-1]) == 1:
            del words[-2:]
        elif len(words) > 1 and len(words[-1]) == 1 and words[-1].isalpha():  # share class letter: "SAAB B", "GRUPO MEXICO B"
            words.pop()
        else:
            break
    return " ".join(words) or name.lower()


def is_equity(holding):
    return (holding.get("asset_type") or "").lower() == "equity"


def match_companies(files, aliases, never_merge=()):
    """Give every equity row a `company` key shared by the same company in every fund (SPEC 6.5).
    Rows are one company if they share an identifier (ISIN, CUSIP or SEDOL), are listed together in
    holding_aliases.yaml, or have the same normalized name AND a compatible location: the same country,
    or one row has no country while that name appears with only one country this run. So "Siemens AG"
    (Germany) and "Siemens Ltd" (India) stay apart, while an ADR without a country still joins its local
    listing. Names in a `never_merge` entry match only their exact spelling.
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

    exact = {name.lower() for entry in never_merge for name in entry["names"]}
    base = lambda name: "raw:" + name.lower() if name.lower() in exact else "name:" + normalize(name)
    equity = [h for f in files for h in f["holdings"] if is_equity(h)]
    countries = {}
    for h in equity:
        if h.get("location"):
            countries.setdefault(base(h["name"]), set()).add(country(h["location"]))

    def node(h):
        key, seen = base(h["name"]), countries.get(base(h["name"]), set())
        location = country(h.get("location")) or (next(iter(seen)) if len(seen) == 1 else "")
        return f"{key}@{location}" if location else key

    by_base = {}
    for h in equity:
        by_base.setdefault(base(h["name"]), set()).add(node(h))
        for field in ("isin", "cusip", "sedol"):
            if h.get(field):
                union(node(h), f"{field}:{h[field]}")
    for alias in aliases:  # explicit: joins every listing of these names, whatever the country
        nodes = [n for name in alias["names"] for n in by_base.get(base(name), ())]
        for n in nodes[1:]:
            union(nodes[0], n)
    for f in files:
        for h in f["holdings"]:
            h["company"] = find(node(h)) if is_equity(h) else None


def top_holdings(file, n=3):
    """Largest equity companies by weight, share classes and listings of one company summed; name from its largest row."""
    companies = {}
    for h in sorted((h for h in file["holdings"] if h["company"]), key=lambda h: -h["weight"]):
        entry = companies.setdefault(h["company"], {"name": h["name"], "weight": 0.0})
        entry["weight"] = round(entry["weight"] + h["weight"], 10)
    return sorted(companies.values(), key=lambda c: (-c["weight"], c["name"]))[:n]


def refresh(funds, out_dir, sources, aliases, get, write, never_merge=()):
    """Fetch each eligible fund's issuer file, write site/data/holdings/<TICKER>.json and set Fund.top_holdings.
    A failed fetch or parse reuses the last good file (stale); with none, the fund gets no holdings."""
    files, memo = {}, {}
    for fund in funds:
        ticker, source = fund["ticker"], sources.get(fund["ticker"])
        if fund["status"] != "Eligible" or not source:
            continue
        path = out_dir / f"{ticker}.json"
        try:
            parsed = fetch(source, get, memo=memo)
            files[ticker] = {"ticker": ticker, "as_of": parsed["as_of"], "fetched_at": datetime.now(timezone.utc).isoformat(),
                             "stale": False, "source": source["url"], "holdings": parsed["holdings"]}
        except Exception as error:
            logging.warning("%s holdings: %s", ticker, error)
            if path.exists():
                try:
                    last = json.loads(path.read_text())
                    if not (last["as_of"] and isinstance(last["holdings"], list)):
                        raise ValueError("no as_of or holdings")
                    files[ticker] = {**last, "stale": True}
                except Exception as error:
                    logging.warning("%s holdings: last good file unusable: %s", ticker, error)
    match_companies(list(files.values()), aliases, never_merge)
    for ticker, file in files.items():
        write(out_dir / f"{ticker}.json", file)
    for fund in funds:
        if fund["ticker"] in files:
            fund["top_holdings"] = top_holdings(files[fund["ticker"]])
        elif fund["status"] == "Eligible":
            logging.info("%s: full holdings unavailable", fund["ticker"])


def fill_holdings(funds, out_dir, write):
    """Pipeline entry point: config from config/holdings_sources.yaml and config/holding_aliases.yaml."""
    sources = yaml.safe_load(SOURCES.read_text())
    overrides = yaml.safe_load(ALIASES.read_text()) or {}
    refresh(funds, out_dir, sources, overrides.get("aliases") or [], Session().get, write, overrides.get("never_merge") or [])
