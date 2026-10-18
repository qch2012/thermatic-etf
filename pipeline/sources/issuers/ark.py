import csv
from datetime import datetime
import io

from .ids import identifiers, pct


def parse_ark(text):
    """ARK `ARK_<FUND>_HOLDINGS.csv`: `date, fund, company, ticker, cusip, shares, market value ($), weight (%)`, then a disclaimer line.
    The `cusip` column holds a CUSIP, a SEDOL or a placeholder (`X9USDGSFT`, `BREADUMMY`). There is no asset class and no country.
    A row with no ticker is a money market fund or a warrant, so it is `Other`, not `Equity`."""
    rows = [row for row in csv.DictReader(io.StringIO(text)) if row["weight (%)"]]
    holdings = []
    for row in rows:
        ticker = row["ticker"] or None
        ids = identifiers(row["cusip"])
        holding = {"name": row["company"], "ticker": ticker, "asset_type": "Equity" if ticker and ids else "Other",
                   "weight": pct(row["weight (%)"])}
        if holding["asset_type"] == "Equity":
            holding.update(ids)
        holdings.append(holding)
    return {"as_of": datetime.strptime(rows[0]["date"], "%m/%d/%Y").date().isoformat(), "holdings": holdings}
