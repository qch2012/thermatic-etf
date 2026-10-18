from datetime import datetime
import re

from .ids import identifiers, pct
from .xlsx import xlsx_rows


def parse_ssga(data):
    """State Street `holdings-daily-us-en-<ticker>.xlsx` (bytes). Header lines (`Holdings: As of 15-Oct-2026`), then Name, Ticker,
    Identifier (CUSIP), SEDOL, Weight (percent, sometimes `1.77E-4`), Sector, Shares Held, Local Currency. No asset class and no country.
    A row with ticker `-` is cash or a money market fund; a CVR (contingent value right, `...CVR...` code) is not a stock either."""
    rows = xlsx_rows(data)
    as_of = datetime.strptime(next(re.search(r"As of (\S+)", row["B"]).group(1) for row in rows if row.get("A") == "Holdings:"), "%d-%b-%Y").date()
    start = next(i for i, row in enumerate(rows) if row.get("A") == "Name") + 1
    holdings = []
    for row in rows[start:]:
        if not row.get("E"):
            continue  # blank rows and the legal text below the table
        ticker = row["B"] if row["B"] != "-" else None
        ids = {**identifiers(row["C"]), **identifiers(row["D"])}
        equity = ticker and ids and "CVR" not in row["C"]
        holding = {"name": row["A"], "ticker": ticker, "asset_type": "Equity" if equity else "Other", "weight": pct(row["E"])}
        if equity:
            holding.update(ids)
        holdings.append(holding)
    return {"as_of": as_of.isoformat(), "holdings": holdings}
