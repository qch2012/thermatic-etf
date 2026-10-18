from datetime import datetime
from html import unescape
import re

from .dates import previous_business_day
from .ids import identifiers


def parse_defiance(text):
    """Defiance `defianceetfs.com/<ticker>-full-holdings/`: a table of ticker, name, CUSIP/SEDOL, weight (percent), shares in the page HTML.
    The page says `as of <next trade date>`, so the holdings are as of the trading day before. No country. A row without a valid
    identifier (cash, a private fund such as `Shield Ai Ii -ic Llc`) is not an Equity row."""
    as_of = re.search(r"as of (\d+/\d+/\d{4})", text).group(1)
    holdings = []
    for tr in text[text.index('id="table-full-holdings"'):].split("<tr")[1:]:
        cells = [unescape(re.sub(r"<[^>]+>", "", td)).strip() for td in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if len(cells) != 5:
            continue
        ticker, name, code, weight, _ = cells
        ids = identifiers(code)
        holding = {"name": name, "ticker": ticker if ids else None, "asset_type": "Equity" if ids else "Cash" if code.startswith(("CASH", "Cash")) else "Other",
                   "weight": round(float(weight.rstrip("%").replace(",", "")) / 100, 10)}
        holding.update(ids)
        holdings.append(holding)
    return {"as_of": previous_business_day(datetime.strptime(as_of, "%m/%d/%Y").date()).isoformat(), "holdings": holdings}
