from datetime import datetime
from html import unescape
import re

from .ids import identifiers, pct


def parse_firsttrust(text):
    """First Trust `ftportfolios.com/retail/etf/EtfHoldings.aspx?Ticker=<T>`: the holdings table is in the page HTML.
    Columns: name, identifier (ticker), CUSIP, classification (industry), quantity, market value, weighting (percent).
    Cash rows have a `$USD`-style identifier and no CUSIP. No country."""
    as_of = re.search(r"Holdings of the Fund as of (\d+/\d+/\d{4})", text).group(1)
    holdings = []
    for tr in text.split("<tr")[1:]:  # rows of the page's layout tables nest, so only a row with exactly 7 cells is a holding
        cells = [unescape(re.sub(r"<[^>]+>", "", td)).strip() for td in re.findall(r"<td[^>]*>(.*?)</td>", tr.split("</tr>")[0], re.S)]
        if len(cells) != 7 or not cells[6].endswith("%"):
            continue  # page chrome and the header row
        name, ticker, cusip, _, _, _, weight = cells
        cash = ticker.startswith("$")
        holding = {"name": name, "ticker": ticker, "asset_type": "Cash" if cash else "Equity" if identifiers(cusip) else "Other", "weight": pct(weight)}
        if not cash:
            holding.update(identifiers(cusip))
        holdings.append(holding)
    return {"as_of": datetime.strptime(as_of, "%m/%d/%Y").date().isoformat(), "holdings": holdings}
