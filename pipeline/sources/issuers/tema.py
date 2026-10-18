import csv
import io

from .ids import identifiers


def parse_tema(text):
    """Tema `<TICKER>-holdings-<MMDDYYYY>.csv`: `holdings_date, ticker, cusip, proper_name, shares, market_value, percent_of_nav
    (a fraction), is_cash, country, sector`. Foreign stocks have no CUSIP, so a stock is any non-cash row that is not a swap."""
    rows = list(csv.DictReader(io.StringIO(text)))
    holdings = []
    for row in rows:
        asset_type = "Cash" if row["is_cash"] == "1" else "Swap" if "-SWAP-" in row["proper_name"].upper() else "Equity"
        holding = {"name": row["proper_name"], "ticker": row["ticker"] or None, "asset_type": asset_type, "weight": float(row["percent_of_nav"])}
        if asset_type == "Equity":
            holding.update(identifiers(row["cusip"]))
            if row["country"]:
                holding["location"] = row["country"]
        holdings.append(holding)
    return {"as_of": rows[0]["holdings_date"], "holdings": holdings}
