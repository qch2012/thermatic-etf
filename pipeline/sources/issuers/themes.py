import csv
from datetime import date
import io

from .dates import previous_business_day
from .ids import identifiers


def parse_themes(text):
    """Themes ETFs `Holdings-<TICKER>.csv` (NATO, BOTT). `weightings` is a percent. `cusip` holds a CUSIP (9 characters) for US
    rows and a SEDOL (7) for foreign rows; cash rows put `CASH<ccy>` there, which is not an identifier."""
    rows = list(csv.DictReader(io.StringIO(text)))
    # `date` is the next trade date (a Monday file is dated Monday), so the holdings are as of the trading day before.
    as_of = previous_business_day(date.fromisoformat(rows[0]["date"]))
    holdings = []
    for row in rows:
        ident = row["cusip"]
        cash = ident.startswith("CASH") or ident == row["stock_ticker"]
        asset_type = "Cash" if cash else "Money Market" if row["money_market_flag"] == "1" else "Equity"
        holding = {"name": row["security_name"], "ticker": row["stock_ticker"], "asset_type": asset_type, "weight": round(float(row["weightings"]) / 100, 10)}
        if asset_type == "Equity":
            holding.update(identifiers(ident))
        if row["country_full"]:
            holding["location"] = row["country_full"]
        holdings.append(holding)
    return {"as_of": as_of.isoformat(), "holdings": holdings}
