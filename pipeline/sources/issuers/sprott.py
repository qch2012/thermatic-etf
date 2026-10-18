import csv
from datetime import datetime
import io
import re
from urllib.parse import unquote

from .ids import identifiers, pct


def parse_sprott(text):
    """Sprott fund page: the page embeds the holdings CSV as a `data:` link named `<T>-holdings-<MM-DD-YYYY>.csv`
    (columns Security, Market Value, Symbol, SEDOL, Quantity, Weight (percent)). No asset class and no country; a row with no
    SEDOL is the cash line."""
    name, data = re.search(r'download="([^"]*-holdings-[\d-]+\.csv)"\s+href="data:application/csv;charset=utf-8,([^"]*)"', text).groups()
    as_of = datetime.strptime(re.search(r"(\d+-\d+-\d{4})\.csv", name).group(1), "%m-%d-%Y").date()
    holdings = []
    for row in csv.DictReader(io.StringIO(unquote(data))):
        ids = identifiers(row["SEDOL"])
        holding = {"name": row["Security"], "ticker": row["Symbol"] or None, "asset_type": "Equity" if ids else "Cash", "weight": pct(row["Weight"])}
        holding.update(ids)
        holdings.append(holding)
    return {"as_of": as_of.isoformat(), "holdings": holdings}
