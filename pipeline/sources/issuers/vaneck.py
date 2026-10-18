from datetime import datetime
import re

from .xlsx import xlsx_rows

from .ids import pct


def parse_vaneck(data):
    """VanEck `vaneck.com/us/en/etf/equity/<ticker>/holdings/download/xlsx/` (bytes). Title row `Daily Holdings (%)  MM/DD/YYYY`, then
    Number, Ticker, Holding Name, Identifier (FIGI), Shares, Asset Class, Market Value, Notional Value, % of Net Assets.
    FIGI is not a CUSIP, ISIN or SEDOL, so no identifier is emitted; names are cut at 40 characters. No country."""
    rows = xlsx_rows(data)
    as_of = datetime.strptime(re.search(r"(\d+/\d+/\d{4})", rows[0]["A"]).group(1), "%m/%d/%Y").date()
    holdings = []
    for row in rows:
        weight = (row.get("I") or "").strip()
        if row.get("A", "").isdigit() and weight.endswith("%"):
            ticker = (row["B"] or "").strip(" -")
            holdings.append({"name": row["C"].strip() or ticker, "ticker": ticker if row["F"] == "Stock" and ticker else None,
                             "asset_type": "Equity" if row["F"] == "Stock" else "Cash", "weight": pct(weight)})
    return {"as_of": as_of.isoformat(), "holdings": holdings}
