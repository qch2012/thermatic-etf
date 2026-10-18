import json


def parse_select(text):
    """Select Funds (Tuttle) `fund-public-api?ticker=<T>&view=all` JSON (EUAD). `weight` is a percent, `security_id` a CUSIP/CINS.
    The API gives no asset class (every row is a stock) and `country` is null, so no `location`."""
    rows = json.loads(text)["holdings"]
    holdings = []
    for row in rows:
        holding = {"name": row["security_name"], "ticker": row["security_ticker"], "asset_type": row["asset_class"] or "Equity",
                   "weight": round(row["weight"] / 100, 10)}
        if len(row["security_id"] or "") == 9:
            holding["cusip"] = row["security_id"]
        if row["country"]:
            holding["location"] = row["country"]
        holdings.append(holding)
    return {"as_of": rows[0]["as_of_date"], "holdings": holdings}
