import csv
from datetime import datetime
import io
import re

from .ids import identifiers, pct


def parse_globalx(text):
    """Global X `<ticker>_full-holdings_<YYYYMMDD>.csv`: two title lines, a header line starting `% of Net Assets`, then rows.
    Percent weights, SEDOL, no asset class and no country. Cash and currency rows have an empty ticker and SEDOL."""
    as_of = re.search(r"as of (\d+/\d+/\d{4})", text).group(1)
    holdings = []
    for row in csv.reader(io.StringIO(text)):
        if len(row) < 7 or row[0].startswith("% of") or not row[2]:
            continue  # title lines, header, disclaimer
        ticker, ids = row[1] or None, identifiers(row[3])
        # A ticker without a SEDOL is a future (`NQZ6 Index`), not a stock.
        holding = {"name": row[2], "ticker": ticker, "asset_type": "Equity" if ids else "Other" if ticker else "Cash", "weight": pct(row[0])}
        holding.update(ids)
        holdings.append(holding)
    return {"as_of": datetime.strptime(as_of, "%m/%d/%Y").date().isoformat(), "holdings": holdings}
