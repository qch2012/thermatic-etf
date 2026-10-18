from html import unescape
import json

from .ids import identifiers, pct

# securityTypeCode values that are stocks. Everything else (currency, money market, futures, synthetic cash) keeps its own name.
EQUITY_CODES = {"COM", "ADR", "DRNY", "DR", "REIT"}


def parse_invesco(text):
    """Invesco `dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/<CUSIP>/holdings/fund?idType=cusip&productType=ETF` JSON.
    `percentageOfTotalNetAssets` is a percent (null on some rows). Names carry HTML entities. No country."""
    data = json.loads(text)
    holdings = []
    for row in data["holdings"]:
        equity = row["securityTypeCode"] in EQUITY_CODES
        holding = {"name": unescape(row["issuerName"]), "ticker": row["ticker"], "asset_type": "Equity" if equity else row["securityTypeName"],
                   "weight": pct(row["percentageOfTotalNetAssets"])}
        if equity:
            holding.update(identifiers(row["cusip"]))
        holdings.append(holding)
    return {"as_of": data["effectiveBusinessDate"], "holdings": holdings}
