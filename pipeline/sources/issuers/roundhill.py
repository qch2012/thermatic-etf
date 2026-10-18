import csv
from datetime import datetime
import io

from .dates import previous_business_day
from .ids import identifiers


def parse_roundhill(text, account):
    """Roundhill `assets/data/FilepointRoundhill.40RU.RU_Holdings_<MMDDYYYY>.csv`: one file for all Roundhill funds, one `Account` per fund.
    `Weightings` is a percent. `Date` is the next trade date. No country. Total return swaps (`-SWAP-`, `TRS` codes), T-bills, money market
    funds and cash are kept with their own asset type, so they stay out of company matching."""
    rows = [row for row in csv.DictReader(io.StringIO(text)) if row["Account"] == account]
    holdings = []
    for row in rows:
        name, ids = row["SecurityName"], identifiers(row["CUSIP"])
        asset_type = ("Swap" if "SWAP" in name.upper() else "Cash" if not ids else "Money Market" if row["MoneyMarketFlag"] == "Y"
                      else "Treasury" if "treasury" in name.lower() else "Equity")
        holding = {"name": name, "ticker": row["StockTicker"] if ids else None, "asset_type": asset_type, "weight": round(float(row["Weightings"].rstrip("%")) / 100, 10)}
        if asset_type == "Equity":
            holding.update(ids)
        holdings.append(holding)
    as_of = previous_business_day(datetime.strptime(rows[0]["Date"], "%m/%d/%Y").date())
    return {"as_of": as_of.isoformat(), "holdings": holdings}
