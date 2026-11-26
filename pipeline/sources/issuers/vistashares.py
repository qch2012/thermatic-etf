import csv
from datetime import datetime
import io
import re

from .ids import pct

CURRENCY = re.compile(r"\b(DOLLAR|EURO|YEN|WON|YUAN|RENMINBI|POUND|FRANC|KRONA|KRONE|RUPEE)\b", re.I)


def parse_vistashares(text):
    """VistaShares `/etf/<ticker>/holdings.csv` (AIS): fund, as_of ("November 20, 2026"), name, ticker, market_value, weight ("8.18%").
    No asset-class column and no identifiers, so non-stock rows are told apart by ticker: `Cash&Other`, a money-market fund
    (5-letter ticker ending XX, e.g. FGXXX) and a currency balance (3-letter ticker named like "NEW TAIWAN DOLLAR")."""
    rows = list(csv.DictReader(io.StringIO(text)))
    holdings = []
    for row in rows:
        ticker = row["ticker"].strip()
        if ticker.lower().startswith("cash") or (len(ticker) == 3 and CURRENCY.search(row["name"])):
            asset_type = "Cash"
        elif re.fullmatch(r"[A-Z]{3}XX", ticker):
            asset_type = "Money Market"
        else:
            asset_type = "Equity"
        holdings.append({"name": row["name"], "ticker": ticker, "asset_type": asset_type, "weight": pct(row["weight"])})
    as_of = datetime.strptime(rows[0]["as_of"], "%B %d, %Y").date()
    return {"as_of": as_of.isoformat(), "holdings": holdings}
