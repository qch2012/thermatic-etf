"""Stocks held across themes (SPEC 6.9): which companies the most themes' eligible funds hold. Display only, never scored.
Uses the issuer holdings files after company matching (holdings.match_companies), so share classes and listings of one
company count once."""
import csv
import io
import re

from .holdings import normalize

MIN_WEIGHT = 0.01  # a smaller position is long-tail noise, not a sign the company belongs to the theme
EXCLUDED_GROUP = "Broad thematic"  # multi-theme funds hold everything and would inflate every large company
DIRECT_COUNTRIES = {"United States", "Canada"}
NOT_A_SHARE = re.compile(r"\b(warrants?|rights?|units?|preferred|notes?|debentures?)\b", re.I)
GENERIC_WORDS = {"group", "holding", "holdings", "technologies", "technology", "international", "intl", "energy", "systems",
                 "industries", "global", "china", "american", "resources", "and", "of"}
# Nasdaq rows read "NVIDIA Corporation - Common Stock", NYSE rows "Cloudflare, Inc. Class A Common Stock": cut the share type.
SHARE_TYPE = re.compile(r"(\s+-\s+.*|\s+(class [a-z]\s+)?(common stock|common shares|ordinary shares|"
                        r"american deposit[ao]ry shares|subordinate voting shares)\b.*)$", re.I)


def listings(directory_text):
    """Exchange-listed US securities from the Nasdaq directory that are shares (no ETFs, test issues, warrants…):
    {"names": normalized company name → symbol, "symbols": symbol → normalized name}. ADRs are included, so TSMC
    maps to TSM. OTC stocks are not in the directory."""
    names, symbols = {}, {}
    for row in csv.DictReader(io.StringIO(directory_text), delimiter="|"):
        if row.get("ETF") != "N" or row.get("Test Issue") != "N" or NOT_A_SHARE.search(row.get("Security Name") or ""):
            continue
        name = normalize(SHARE_TYPE.sub("", row["Security Name"]))
        names.setdefault(name, row["Symbol"])
        symbols[row["Symbol"]] = name
    return {"names": names, "symbols": symbols}


def us_symbol(holding, listed):
    """The holding's US exchange symbol, or None. By company name first; else by the fund's own ticker
    ("AMT", "SQM US") when the two names share a distinctive word ("Telefonaktiebolaget LM Ericsson" / "Ericsson",
    "INTL BUSINESS MACHINES" / "International Business Machines"), so UK "BA" (BAE) never becomes NYSE "BA" (Boeing)."""
    name = normalize(holding["name"])
    if name in listed["names"]:
        return listed["names"][name]
    ticker = re.sub(r"\s+U[A-Z]?$", "", (holding.get("ticker") or "").strip())
    listed_name = listed["symbols"].get(ticker)
    return ticker if listed_name and (set(name.split()) & set(listed_name.split())) - GENERIC_WORDS else None


def build(funds, files, listed):
    """funds: screen.json funds. files: ticker → holdings file with `company` keys. listed: from listings().
    Returns stocks held at MIN_WEIGHT or more by eligible funds in 2+ themes, most themes first."""
    by_ticker = {f["ticker"]: f for f in funds}
    stocks = {}
    for ticker, file in files.items():
        fund = by_ticker.get(ticker)
        if not fund or fund["status"] != "Eligible" or fund["group"] == EXCLUDED_GROUP:
            continue
        weights, rows = {}, {}
        for h in file["holdings"]:
            if h.get("company"):
                weights[h["company"]] = weights.get(h["company"], 0.0) + (h["weight"] or 0.0)
                rows.setdefault(h["company"], []).append(h)
        for company, weight in weights.items():
            if weight >= MIN_WEIGHT:
                stock = stocks.setdefault(company, {"rows": [], "funds": []})
                stock["rows"] += rows[company]
                stock["funds"].append({"ticker": ticker, "theme": fund["theme"], "weight": round(weight, 6)})
    out = []
    for stock in stocks.values():
        themes = sorted({f["theme"] for f in stock["funds"]})
        if len(themes) < 2:
            continue
        rows = sorted(stock["rows"], key=lambda h: -(h["weight"] or 0))
        country = next((h["location"] for h in rows if h.get("location")), None)
        symbol = next(filter(None, (us_symbol(h, listed) for h in rows)), None)
        if country in DIRECT_COUNTRIES:
            listing = f"Based in {country}"
        elif symbol:
            listing = f"US exchange listing {symbol}"
        else:
            listing = "No US exchange listing found; hold through an ETF"
        fund_list = sorted(stock["funds"], key=lambda f: (-f["weight"], f["ticker"]))
        out.append({"name": rows[0]["name"], "ticker": symbol or rows[0].get("ticker"), "country": country,
                    "direct": country in DIRECT_COUNTRIES or symbol is not None, "listing": listing, "themes": themes,
                    "avg_weight": round(sum(f["weight"] for f in fund_list) / len(fund_list), 6), "funds": fund_list})
    return sorted(out, key=lambda s: (-len(s["themes"]), -len(s["funds"]), -s["avg_weight"], s["name"]))
