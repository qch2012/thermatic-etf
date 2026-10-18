import json

from .ids import identifiers, pct


def parse_select(text):
    """Select Funds (Tuttle) `fund-public-api?ticker=<T>&view=all` JSON (EUAD, HBMX, FOTO). `weight` is a percent, `security_id` a CUSIP/CINS.
    `asset_class` is never filled and `country` is null. A row is a stock only if it has a valid identifier: rows without one are cash
    (`CASH AND CASH EQUIVALENTS`), swaps (`RECV/PAYB <FUND> TRS <TICKER> EQ`, which come as paired positive and negative legs) or other."""
    rows = json.loads(text)["holdings"]
    holdings = []
    for row in rows:
        name, ids = row["security_name"], identifiers(row["security_id"])
        upper = name.upper()
        equity = bool(ids) and "T-BILL" not in upper and row["weight"] >= 0
        asset_type = row["asset_class"] or ("Equity" if equity else "Cash" if "CASH" in upper else "Swap" if "TRS" in upper.split() or "SWAP" in upper else "Other")
        holding = {"name": name, "ticker": row["security_ticker"], "asset_type": asset_type, "weight": pct(row["weight"])}
        if asset_type == "Equity":
            holding.update(ids)
        if row["country"]:
            holding["location"] = row["country"]
        holdings.append(holding)
    return {"as_of": rows[0]["as_of_date"], "holdings": holdings}
